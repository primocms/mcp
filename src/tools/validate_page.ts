import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { load as loadYaml } from "js-yaml";

import { sanitizeFilename, validatePage as runValidatePage, type AvailableBlockInput, type ValidatePageInput } from "../validators/page.js";
import { resultFromErrors, type ValidationError, type ValidationResult } from "../validators/types.js";
import { requireRecord, requireString, validationOutputSchema } from "./validation_schemas.js";

export type ValidatePageOnDiskInput = {
	site_path: string;
	page_path: string;
};

export const validatePageTool = {
	name: "validate_page",
	description:
		"Validate a Primo page by reading its YAML file from disk, resolving its page type from page-types/{page_type}/, and checking every section against the block field definitions actually present in blocks/. Errors if the page file or its page-type config is missing, and if a section references a block that has no blocks/{name}/ folder (that section would render empty). Because it reads the real files, it catches pages that reference blocks or page types that were never written to disk — which inline validation cannot.",
	inputSchema: {
		type: "object",
		properties: {
			site_path: {
				type: "string",
				description: "Absolute path to the site export folder containing site.yaml, pages/, page-types/, and blocks/."
			},
			page_path: {
				type: "string",
				description: 'Path to the page file, relative to site_path, e.g. "pages/index.yaml".'
			}
		},
		required: ["site_path", "page_path"],
		additionalProperties: false
	},
	outputSchema: validationOutputSchema
} as const;

async function readFileResult(
	filePath: string,
	file: string,
	requiredHint: string,
	errors: ValidationError[]
): Promise<string | undefined> {
	try {
		return await readFile(filePath, "utf-8");
	} catch (error) {
		const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
		errors.push({
			file,
			severity: "error",
			message: missing
				? `${file} does not exist on disk at ${filePath}.`
				: `${file} could not be read from ${filePath}.`,
			fix_hint: missing ? requiredHint : `Check file permissions on ${file}.`
		});
		return undefined;
	}
}

// Scan blocks/*/fields.yaml so page sections are validated against the block
// field definitions that actually exist on disk. A section pointing at a block
// with no folder here is flagged as an error by validatePage's section check —
// the same silent-render-empty failure that motivated the on-disk block tool.
async function readAvailableBlocks(sitePath: string): Promise<AvailableBlockInput[]> {
	const blocksDir = path.join(sitePath, "blocks");
	let entries: string[];
	try {
		const dirents = await readdir(blocksDir, { withFileTypes: true });
		entries = dirents.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
	} catch {
		// No blocks/ dir at all — every section reference will fail, which is the
		// correct, loud outcome. Return an empty set rather than throwing.
		return [];
	}

	const blocks: AvailableBlockInput[] = [];
	for (const name of entries) {
		try {
			const fields_yaml = await readFile(path.join(blocksDir, name, "fields.yaml"), "utf-8");
			blocks.push({ name, fields_yaml });
		} catch {
			// A block folder without fields.yaml can't contribute field defs; skip
			// it. If a page references it, the missing-block error still fires.
		}
	}

	return blocks;
}

// Read a page and everything it depends on from disk, then validate. Resolves
// the page type from the page's own `page_type` slug (page-types/<slug>/), and
// derives available blocks by scanning blocks/. Unlike validatePage, which
// trusts the strings it is handed, this errors when the page file or its
// page-type config is absent.
export async function validatePageFromDisk(input: ValidatePageOnDiskInput): Promise<ValidationResult> {
	const sitePath = path.resolve(input.site_path);
	const pagePath = input.page_path;
	const errors: ValidationError[] = [];

	const page_yaml = await readFileResult(
		path.join(sitePath, pagePath),
		pagePath,
		`Write ${pagePath} first, or create it with the editor.`,
		errors
	);
	if (page_yaml === undefined) {
		return resultFromErrors(errors);
	}

	// Resolve which page-type folder to read from the page's own page_type slug.
	// Fall back to "default" when unset so a page missing page_type still points
	// somewhere meaningful; the in-memory validator flags the mismatch.
	let pageTypeSlug = "default";
	try {
		const parsed = loadYaml(page_yaml);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			const rawType = (parsed as Record<string, unknown>).page_type;
			if (typeof rawType === "string" && rawType.length > 0) {
				pageTypeSlug = sanitizeFilename(rawType);
			}
		}
	} catch {
		// Leave the slug at "default"; validatePage will report the parse error.
	}

	const pageTypeDir = path.join(sitePath, "page-types", pageTypeSlug);
	const page_type_yaml = await readFileResult(
		path.join(pageTypeDir, "config.yaml"),
		`page-types/${pageTypeSlug}/config.yaml`,
		`Create page-types/${pageTypeSlug}/config.yaml (e.g. with scaffold_page_type), or set the page's page_type to an existing page type.`,
		errors
	);
	if (page_type_yaml === undefined) {
		return resultFromErrors(errors);
	}

	// A page type with no fields.yaml simply has no page-level fields. Treat a
	// missing file as an empty list rather than an error.
	let page_type_fields_yaml = "[]";
	try {
		page_type_fields_yaml = await readFile(path.join(pageTypeDir, "fields.yaml"), "utf-8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			errors.push({
				file: `page-types/${pageTypeSlug}/fields.yaml`,
				severity: "error",
				message: `page-types/${pageTypeSlug}/fields.yaml could not be read.`,
				fix_hint: `Check file permissions on page-types/${pageTypeSlug}/fields.yaml.`
			});
			return resultFromErrors(errors);
		}
	}

	const available_blocks = await readAvailableBlocks(sitePath);

	const result = validatePage({
		page_path: pagePath,
		page_yaml,
		page_type_yaml,
		page_type_fields_yaml,
		available_blocks
	});

	// Merge any read-stage errors (currently none reach here, but keep the shape
	// correct if that changes) with the validator's findings.
	return resultFromErrors([...errors, ...result.errors]);
}

export function validatePage(input: ValidatePageInput): ValidationResult {
	return runValidatePage(input);
}

export function readValidatePageInput(args: unknown): ValidatePageOnDiskInput {
	const record = requireRecord(args, validatePageTool.name);

	return {
		site_path: requireString(record, "site_path", validatePageTool.name),
		page_path: requireString(record, "page_path", validatePageTool.name)
	};
}
