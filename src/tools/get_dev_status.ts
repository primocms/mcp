import fs from "node:fs/promises";
import path from "node:path";
import { load as loadYaml } from "js-yaml";
import { requireRecord, requireString } from "./validation_schemas.js";

export type GetDevStatusInput = {
	site_path: string;
};

// One dropped/skipped field from the last import, mirrored from the CLI's
// ImportWarning shape (primo-cli/src/commands/dev.ts). Present only when the
// last import produced warnings.
export type DevWarningDetail = {
	kind: string;
	file: string;
	path: string;
	field: string;
	block: string;
	message: string;
};

// The raw sync_status.json shape as written by `primo dev`
// (write_sync_status in primo-cli). All fields past `ok` are optional so we
// tolerate both older writers (count-only) and newer ones (with details).
type RawSyncStatus = {
	ok?: boolean;
	warnings?: number;
	warned_at?: string;
	warning_details?: DevWarningDetail[];
	error?: string;
	failed_at?: string;
	port?: number;
	url?: string;
	last_import_at?: string;
};

export type GetDevStatusResult = {
	// True only when a sync_status.json was found AND its last import succeeded.
	// False when the last import failed OR no status file exists yet.
	ok: boolean;
	// Whether a .primo/sync_status.json was found at all. When false, `primo
	// dev` has not run for this site (or has not completed a first import), so
	// there is no state to report — the caller should ask the user to run it
	// rather than spawning a server.
	running: boolean;
	// Number of fields dropped/skipped in the last import (0 on a clean import).
	warning_count: number;
	// Full per-field records for each dropped field. Empty on a clean import
	// or when the writer only recorded a count.
	warning_details: DevWarningDetail[];
	// Populated only when the last import failed (running=true, ok=false).
	error?: string;
	failed_at?: string;
	warned_at?: string;
	// When the status file was last written — lets the caller tell a fresh
	// status from a stale one.
	last_import_at?: string;
	// True when one or more source files under the site were modified AFTER
	// last_import_at — i.e. disk and CMS have drifted and the last import no
	// longer reflects what's on disk. sync_status.json records only the last
	// IMPORT outcome; it cannot know whether the watcher subsequently missed a
	// file create/edit. This mtime-vs-last_import_at check is the only signal
	// that catches a dropped watcher event, so `ok` alone must never be read as
	// "disk agrees with CMS". Undefined when we couldn't determine it (no
	// last_import_at, or the site dir couldn't be scanned).
	files_modified_since_import?: boolean;
	// Relative paths of the files newer than last_import_at (capped), so the
	// agent can see exactly what hasn't been imported. Empty/absent when none.
	stale_files?: string[];
	// Where the running dev server can be reached, so the agent never has to
	// spawn its own to find out.
	port?: number;
	url?: string;
	// True when the site was never registered with the workspace CMS —
	// site.yaml has no site_id (or doesn't exist for a site-shaped folder).
	// `primo dev` skips such sites with a warning, so "run primo dev" is a
	// dead end; the fix is `primo add <folder>` from the workspace root.
	// Present only when running=false and the condition was detected.
	unregistered?: boolean;
	// Human-readable one-liner summarizing the state.
	message: string;
};

// Source directories `primo dev` imports from — mirrors SITE_SYNC_DIRS in
// primo-cli/src/commands/dev.ts (plus uploads, which the watcher also imports).
// If that list changes there, keep this in sync so drift detection stays honest.
const SITE_SOURCE_DIRS = ["blocks", "page-types", "pages", "site", "uploads"];

// How many stale paths to list before truncating. The count still reflects
// reality; we just don't flood the tool output.
const MAX_STALE_FILES = 25;

// Files written within this window BEFORE last_import_at aren't counted as
// drift. The import's own writeback (renamed uploads, normalized YAML) lands
// microseconds after the timestamp is stamped; a small backdated tolerance
// keeps that self-echo from reading as a stale user edit.
const IMPORT_WRITEBACK_TOLERANCE_MS = 2000;

export const getDevStatusTool = {
	name: "get_dev_status",
	description:
		"Read the current `primo dev` state for a site without spawning a dev server yourself. Returns whether the last file→CMS import succeeded, exactly which fields were dropped (file, path, block, field, message), when it last imported, and where the running server is (port/url). Use this instead of starting your own dev server — the user runs `primo dev` in their own terminal and this reads the state it writes to .primo/sync_status.json. If `running` is false, `primo dev` has not completed a first import for this site; ask the user to run it rather than launching one. If `unregistered` is true, the site was never registered with the workspace CMS (site.yaml has no site_id) and `primo dev` would skip it — ask the user to run `primo add <folder>` from the workspace root instead.",
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
			running: { type: "boolean" },
			warning_count: { type: "integer", minimum: 0 },
			warning_details: {
				type: "array",
				items: {
					type: "object",
					properties: {
						kind: { type: "string" },
						file: { type: "string" },
						path: { type: "string" },
						field: { type: "string" },
						block: { type: "string" },
						message: { type: "string" }
					},
					required: ["kind", "file", "path", "field", "block", "message"],
					additionalProperties: false
				}
			},
			error: { type: "string" },
			failed_at: { type: "string" },
			warned_at: { type: "string" },
			last_import_at: { type: "string" },
			files_modified_since_import: { type: "boolean" },
			stale_files: { type: "array", items: { type: "string" } },
			port: { type: "integer" },
			url: { type: "string" },
			unregistered: { type: "boolean" },
			message: { type: "string" }
		},
		required: ["ok", "running", "warning_count", "warning_details", "message"],
		additionalProperties: false
	}
} as const;

// Coerce one raw warning entry into a DevWarningDetail, tolerating partial
// shapes from older/other writers so the output schema always holds.
function normalizeWarning(raw: unknown): DevWarningDetail {
	const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
	const str = (v: unknown) => (typeof v === "string" ? v : "");
	return {
		kind: str(r.kind),
		file: str(r.file),
		path: str(r.path),
		field: str(r.field),
		block: str(r.block),
		message: str(r.message)
	};
}

// Walk the site's source dirs and return the relative paths of files whose
// mtime is newer than `importedAtMs` (past the writeback tolerance). This is
// what catches a watcher that dropped a create/edit: the file exists on disk,
// is newer than the last import, yet sync_status.json still reads ok. Bounded
// output (MAX_STALE_FILES) but the returned flag reflects whether ANY exist.
//
// `complete` distinguishes "scanned everything, found no drift" from "couldn't
// finish the scan" (a permission/I/O error). The caller MUST NOT report
// files_modified_since_import: false — nor the "all content is in the CMS"
// message — off an incomplete scan, or we'd reintroduce the exact false
// confidence this check exists to eliminate. Only an expected missing
// directory (ENOENT — e.g. a site with no uploads/) is treated as empty.
type DriftScan = { stale: string[]; complete: boolean }

function is_enoent(err: unknown): boolean {
	return (err as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

async function findFilesModifiedSince(
	sitePath: string,
	importedAtMs: number
): Promise<DriftScan> {
	// Ignore files written up to the tolerance AFTER the import stamp — that's
	// the import's own writeback (renamed uploads, normalized YAML) landing
	// microseconds later. Adding the tolerance moves the cutoff forward so those
	// self-writes fall at or below it; a genuine later user edit still exceeds it.
	const cutoff = importedAtMs + IMPORT_WRITEBACK_TOLERANCE_MS;
	const stale: string[] = [];
	let complete = true;

	async function walk(dir: string, relBase: string): Promise<void> {
		let entries;
		try {
			entries = await fs.readdir(dir, { withFileTypes: true });
		} catch (err) {
			// A missing optional dir (no uploads/, etc.) is expected — skip it.
			// Any other error (permissions, I/O) means the scan is incomplete;
			// record that so the caller doesn't infer a clean disk.
			if (!is_enoent(err)) complete = false;
			return;
		}
		for (const entry of entries) {
			if (entry.name.startsWith(".")) continue;
			const full = path.join(dir, entry.name);
			const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
			if (entry.isDirectory()) {
				await walk(full, rel);
				continue;
			}
			if (!entry.isFile()) continue;
			try {
				const st = await fs.stat(full);
				if (st.mtimeMs > cutoff) stale.push(rel);
			} catch (err) {
				// A file that vanished mid-walk (ENOENT) is fine — it's gone, not
				// stale. Any other stat error leaves this file's state unknown,
				// so the scan is no longer authoritative.
				if (!is_enoent(err)) complete = false;
			}
		}
	}

	for (const dir of SITE_SOURCE_DIRS) {
		await walk(path.join(sitePath, dir), dir);
	}
	stale.sort();
	return { stale, complete };
}

// Distinguish "dev hasn't run yet" from "this site was never registered".
// A site.yaml without a site_id can never import — `primo dev` skips it with
// a warning — so answering "run primo dev" would send the agent (and user)
// in a circle. Only `primo add` mints the id and registers the site.
//   - "unregistered": site.yaml exists without a usable site_id, or there is
//     no site.yaml but the folder carries site content dirs
//   - "registered":   site.yaml has a site_id (dev just hasn't run/imported)
//   - "unknown":      couldn't tell (unreadable yaml, or not site-shaped) —
//     fall back to the generic not-running message
type RegistrationCheck = "unregistered" | "registered" | "unknown";

async function checkRegistration(sitePath: string): Promise<RegistrationCheck> {
	try {
		const raw = await fs.readFile(path.join(sitePath, "site.yaml"), "utf-8");
		const parsed = loadYaml(raw);
		const site_id =
			typeof parsed === "object" && parsed !== null
				? (parsed as Record<string, unknown>).site_id
				: undefined;
		return typeof site_id === "string" && site_id.trim() ? "registered" : "unregistered";
	} catch (err) {
		if (is_enoent(err)) {
			// No site.yaml at all. Site-shaped folders (they carry the content
			// dirs a real site has) are unregistered; anything else is likely a
			// wrong path, where `primo add` guidance would mislead.
			for (const marker of ["pages", "blocks", "page-types", "site"]) {
				try {
					// Must be a directory — a plain file named e.g. `pages` in a
					// non-site folder would otherwise earn `primo add` guidance.
					const stat = await fs.stat(path.join(sitePath, marker));
					if (stat.isDirectory()) return "unregistered";
				} catch {
					// keep looking
				}
			}
		}
		return "unknown";
	}
}

async function readSyncStatus(sitePath: string): Promise<RawSyncStatus | null> {
	try {
		const raw = await fs.readFile(path.join(sitePath, ".primo", "sync_status.json"), "utf-8");
		const parsed = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null) return null;
		return parsed as RawSyncStatus;
	} catch {
		// Missing file, unreadable dir, or malformed JSON — treated as "no
		// status" rather than an error so the caller gets a clean not-running
		// result instead of a thrown tool error.
		return null;
	}
}

export async function getDevStatus(input: GetDevStatusInput): Promise<GetDevStatusResult> {
	const sitePath = path.resolve(input.site_path);
	const status = await readSyncStatus(sitePath);

	if (!status) {
		if (await checkRegistration(sitePath) === "unregistered") {
			const folder = path.basename(sitePath);
			return {
				ok: false,
				running: false,
				unregistered: true,
				warning_count: 0,
				warning_details: [],
				message: `This site isn't registered with the workspace CMS — site.yaml has no site_id (or doesn't exist yet). \`primo dev\` skips unregistered sites with a warning, so running it will NOT import this site. Ask the user to run \`primo add ${folder}\` from the workspace root to register and import it — do not spawn a dev server yourself.`
			};
		}
		return {
			ok: false,
			running: false,
			warning_count: 0,
			warning_details: [],
			message: `No dev status found at ${sitePath}/.primo/sync_status.json. \`primo dev\` has not run (or not completed a first import) for this site. Ask the user to run \`primo dev\` in this directory — do not spawn a dev server yourself.`
		};
	}

	const warning_details = Array.isArray(status.warning_details)
		? status.warning_details.map(normalizeWarning)
		: [];
	// Prefer the persisted count, but only when it's a sane non-negative
	// integer — a corrupt file must never produce a negative/fractional count
	// that violates the output schema. Otherwise fall back to the detail
	// length so a details-only writer still reports a count.
	const warning_count =
		Number.isSafeInteger(status.warnings) && (status.warnings as number) >= 0
			? (status.warnings as number)
			: warning_details.length;

	const base = {
		running: true,
		warning_count,
		warning_details,
		...(typeof status.last_import_at === "string" ? { last_import_at: status.last_import_at } : {}),
		...(typeof status.port === "number" ? { port: status.port } : {}),
		...(typeof status.url === "string" ? { url: status.url } : {})
	};

	// Last import failed — the CMS still holds pre-edit state.
	if (status.ok === false) {
		const error = typeof status.error === "string" ? status.error : "unknown error";
		return {
			ok: false,
			...base,
			error,
			...(typeof status.failed_at === "string" ? { failed_at: status.failed_at } : {}),
			message: `Last file→CMS import FAILED${status.failed_at ? ` at ${status.failed_at}` : ""}. The CMS holds pre-edit state until this is fixed. Error: ${error}`
		};
	}

	// A status file exists but doesn't record a definitive outcome (ok is
	// neither true nor false — a partial/corrupt write). Never infer success:
	// report ok:false so the caller doesn't build a preview from unknown state.
	if (status.ok !== true) {
		return {
			ok: false,
			...base,
			message: `Dev status at ${sitePath}/.primo/sync_status.json is incomplete (no definitive import outcome). Treat the CMS state as unknown — do not build a preview until \`primo dev\` records a successful import.`
		};
	}

	// The last import SUCCEEDED — but success only means the import that ran
	// completed, not that disk still agrees with the CMS. If a file was created
	// or edited after last_import_at (and the watcher dropped the event, or a
	// push simply hasn't fired yet), the CMS is stale. Detect that by comparing
	// on-disk mtimes against last_import_at.
	//
	// Three outcomes, and only one lets us claim disk agrees with the CMS:
	//   - unknown  → no last_import_at to compare against, OR the scan hit a
	//                permission/I/O error and couldn't finish. We must NOT
	//                assert "in the CMS" or files_modified_since_import: false;
	//                omit the drift fields and say we couldn't verify.
	//   - drifted  → a file is newer than the import; flag it.
	//   - clean    → scan finished, nothing newer; safe to claim agreement.
	const importedAtMs = status.last_import_at ? Date.parse(status.last_import_at) : NaN;
	const scan = Number.isFinite(importedAtMs)
		? await findFilesModifiedSince(sitePath, importedAtMs)
		: null;
	const drifted = scan !== null && scan.complete && scan.stale.length > 0;
	// "Known" means we have an authoritative answer: a finished scan against a
	// real timestamp. An unfinished scan (or no timestamp) is not known.
	const drift_known = scan !== null && scan.complete;
	const driftBase = drift_known
		? {
			files_modified_since_import: drifted,
			...(drifted ? { stale_files: scan.stale.slice(0, MAX_STALE_FILES) } : {})
		}
		: {};
	const staleClause = drifted
		? ` ⚠ ${scan.stale.length} file${scan.stale.length === 1 ? " has" : "s have"} changed on disk since then and ${scan.stale.length === 1 ? "is" : "are"} NOT yet in the CMS (see stale_files) — the last import does not reflect current disk. Wait for \`primo dev\` to import, or if it doesn't fire, re-save the file to retrigger the watcher.`
		: "";
	// When we couldn't verify (scan incomplete despite having a timestamp),
	// caveat the success rather than claiming agreement we didn't establish.
	const unverifiedClause = scan !== null && !scan.complete
		? " Could not verify disk against the CMS (some files were unreadable), so agreement is unconfirmed."
		: "";

	// Last import succeeded but dropped fields.
	if (warning_count > 0) {
		return {
			ok: true,
			...base,
			...driftBase,
			...(typeof status.warned_at === "string" ? { warned_at: status.warned_at } : {}),
			message: `Last import succeeded but dropped ${warning_count} field${warning_count === 1 ? "" : "s"} — that content is not in the CMS. See warning_details for exactly what was dropped and where.${staleClause}${unverifiedClause}`
		};
	}

	// Clean import. Only claim "all file content is in the CMS" when a finished
	// scan actually confirmed no drift.
	const cleanTail = drifted
		? `, but disk and CMS have since drifted.${staleClause}`
		: unverifiedClause
			? `.${unverifiedClause}`
			: drift_known
				? ". All file content is in the CMS."
				: "."; // no timestamp to verify against — don't overclaim
	return {
		ok: true,
		...base,
		...driftBase,
		message: `Last import succeeded with no dropped fields${status.last_import_at ? ` (${status.last_import_at})` : ""}${cleanTail}`
	};
}

export function readGetDevStatusInput(args: unknown): GetDevStatusInput {
	const record = requireRecord(args, getDevStatusTool.name);
	return {
		site_path: requireString(record, "site_path", getDevStatusTool.name)
	};
}
