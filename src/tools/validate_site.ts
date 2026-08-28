import { readFile } from "node:fs/promises";
import path from "node:path";

import { validateSiteHead } from "../validators/svelte.js";
import { resultFromErrors, type ValidationResult } from "../validators/types.js";
import { requireRecord, requireString, validationOutputSchema } from "./validation_schemas.js";

export type ValidateSiteInput = {
	head_svelte: string;
};

export type ValidateSiteOnDiskInput = {
	site_path: string;
};

export const validateSiteTool = {
	name: "validate_site",
	description:
		"Validate site-level Primo files by reading site/head.svelte from disk. Primo injects head.svelte into a generated <svelte:head>, so the file must contain only head children (<title>, <meta>, <link>, <script>, <style>) and never wrap them in <svelte:head> itself — that produces nested tags and the importer rejects the site with a 500. A site with no head.svelte is valid; a present file is checked for Svelte 5 syntax and the import contract.",
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
	outputSchema: validationOutputSchema
} as const;

export async function validateSiteFromDisk(input: ValidateSiteOnDiskInput): Promise<ValidationResult> {
	const headPath = path.join(path.resolve(input.site_path), "site", "head.svelte");

	let head_svelte: string;
	try {
		head_svelte = await readFile(headPath, "utf-8");
	} catch (error) {
		// A missing head.svelte is valid — many sites have no custom <head>.
		// Any other read error is a real problem worth surfacing.
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return resultFromErrors([]);
		}
		return resultFromErrors([
			{
				file: "site/head.svelte",
				severity: "error",
				message: `site/head.svelte could not be read from ${headPath}.`,
				fix_hint: "Check file permissions on site/head.svelte."
			}
		]);
	}

	return validateSite({ head_svelte });
}

export function validateSite(input: ValidateSiteInput): ValidationResult {
	if (input.head_svelte.trim().length === 0) {
		return resultFromErrors([]);
	}
	return resultFromErrors(validateSiteHead(input.head_svelte, "site/head.svelte"));
}

export function readValidateSiteInput(args: unknown): ValidateSiteOnDiskInput {
	const record = requireRecord(args, validateSiteTool.name);
	return {
		site_path: requireString(record, "site_path", validateSiteTool.name)
	};
}
