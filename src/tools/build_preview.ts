import fs from "node:fs/promises";
import path from "node:path";
import { load as loadYaml } from "js-yaml";
import { compileAndUploadPublishArtifacts } from "./publish_compiler.js";
import { requireRecord, requireString } from "./validation_schemas.js";

export type BuildPreviewInput = {
	site_path: string;
};

export type BuildPreviewResult = {
	ok: boolean;
	site_url: string;
	message?: string;
};

export const buildPreviewTool = {
	name: "build_preview",
	description:
		"Regenerate the published preview of a Primo site so file changes are visible at the site URL. Requires a running palacms server (started by `primo dev`); call this after editing block, page, or page-type files and `primo dev` has reported it imported the change.",
	inputSchema: {
		type: "object",
		properties: {
			site_path: {
				type: "string",
				description: "Absolute path to the site export folder containing site.yaml."
			}
		},
		required: ["site_path"],
		additionalProperties: false
	},
	outputSchema: {
		type: "object",
		properties: {
			ok: { type: "boolean" },
			site_url: { type: "string" },
			message: { type: "string" }
		},
		required: ["ok", "site_url"],
		additionalProperties: false
	}
} as const;

const DEFAULT_PORT = 8090;

type SiteYaml = { site_id?: string; host?: string };
type ServerYaml = { port?: number };
type SiteRecord = { id: string; name: string; host?: string; head?: string; foot?: string };

async function readYamlFile<T>(filePath: string): Promise<T> {
	const raw = await fs.readFile(filePath, "utf-8");
	return loadYaml(raw) as T;
}

async function findServerYaml(startDir: string): Promise<ServerYaml | null> {
	let dir = startDir;
	while (true) {
		const candidate = path.join(dir, "server.yaml");
		try {
			return await readYamlFile<ServerYaml>(candidate);
		} catch {
			// continue walking up
		}
		const parent = path.dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
}

async function fetchSiteRecord(apiUrl: string, token: string, siteId: string): Promise<SiteRecord | null> {
	const response = await fetch(`${apiUrl}/api/collections/sites/records/${siteId}`, {
		headers: {
			Authorization: token
		}
	});
	if (response.status === 404) return null;
	if (!response.ok) {
		const body = await response.text().catch(() => "");
		throw new Error(`Could not read site record (HTTP ${response.status}): ${body || "no body"}`);
	}
	return (await response.json()) as SiteRecord;
}

type SyncStatus =
	| { ok: true }
	| { ok: false; error: string; failed_at: string };

async function readSyncStatus(sitePath: string): Promise<SyncStatus | null> {
	try {
		const raw = await fs.readFile(path.join(sitePath, ".primo", "sync_status.json"), "utf-8");
		return JSON.parse(raw) as SyncStatus;
	} catch {
		return null;
	}
}

export async function buildPreview(input: BuildPreviewInput): Promise<BuildPreviewResult> {
	const sitePath = path.resolve(input.site_path);

	const site = await readYamlFile<SiteYaml>(path.join(sitePath, "site.yaml")).catch(() => {
		throw new Error(`No site.yaml found at ${sitePath}/site.yaml — pass the directory that contains site.yaml.`);
	});
	if (!site.site_id) {
		throw new Error(`site.yaml at ${sitePath} is missing site_id.`);
	}

	// If the most recent file→CMS push failed, the DB still holds the
	// pre-edit state. Compiling that would silently produce a "successful"
	// preview of stale content, so refuse and surface the import error
	// instead. The agent can fix the source file and retry.
	const sync_status = await readSyncStatus(sitePath);
	if (sync_status && !sync_status.ok) {
		return {
			ok: false,
			site_url: "",
			message: `Most recent file→CMS push failed at ${sync_status.failed_at} and the CMS still holds pre-edit state. Fix the source error and let primo dev re-import before building preview. Error: ${sync_status.error}`
		};
	}

	const server = await findServerYaml(sitePath);
	const port = server?.port ?? DEFAULT_PORT;
	const apiUrl = `http://127.0.0.1:${port}`;

	let authResponse: Response;
	try {
		authResponse = await fetch(`${apiUrl}/api/palacms/dev-auth`, { method: "POST" });
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		throw new Error(
			`Could not reach palacms server at ${apiUrl} (${reason}). Is \`primo dev\` running in this site's directory?`
		);
	}
	if (!authResponse.ok) {
		throw new Error(
			`palacms server at ${apiUrl} did not return a dev token (HTTP ${authResponse.status}). Is \`primo dev\` running?`
		);
	}
	const auth = (await authResponse.json()) as { token?: string };
	if (!auth.token) {
		throw new Error(`palacms dev-auth response did not include a token.`);
	}

	const siteRecord = await fetchSiteRecord(apiUrl, auth.token, site.site_id);
	if (!siteRecord) {
		throw new Error(
			`Site ${site.site_id} was not found in the palacms server at ${apiUrl}. Is \`primo dev\` running for ${sitePath}?`
		);
	}
	const summary = await compileAndUploadPublishArtifacts(apiUrl, auth.token, siteRecord);

	const generateResponse = await fetch(`${apiUrl}/api/palacms/generate`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: auth.token
		},
		body: JSON.stringify({ site_id: site.site_id })
	});
	if (!generateResponse.ok) {
		const body = await generateResponse.text().catch(() => "");
		throw new Error(`generate failed (HTTP ${generateResponse.status}): ${body || "no body"}`);
	}

	const host = siteRecord.host || site.host;
	const siteUrl = host ? `http://${host}` : `${apiUrl}/?_site=${encodeURIComponent(site.site_id)}`;

	return {
		ok: true,
		site_url: siteUrl,
		message: `Compiled ${summary.pageCount} page${summary.pageCount === 1 ? "" : "s"} and ${summary.symbolCount} symbol script${summary.symbolCount === 1 ? "" : "s"}, then rebuilt preview for site ${site.site_id}. Visit ${siteUrl} to verify.`
	};
}

export function readBuildPreviewInput(args: unknown): BuildPreviewInput {
	const record = requireRecord(args, buildPreviewTool.name);
	return {
		site_path: requireString(record, "site_path", buildPreviewTool.name)
	};
}
