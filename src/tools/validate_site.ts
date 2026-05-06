import { validateSiteHead } from "../validators/svelte.js";
import { resultFromErrors, type ValidationResult } from "../validators/types.js";
import { requireRecord, requireString, validationOutputSchema } from "./validation_schemas.js";

export type ValidateSiteInput = {
	head_svelte: string;
};

export const validateSiteTool = {
	name: "validate_site",
	description:
		"Validate site-level Primo files (currently site/head.svelte) for Svelte 5 syntax and Primo's import contract. Primo injects head.svelte into a generated <svelte:head>, so the file must contain only head children (<title>, <meta>, <link>, <script>, <style>) and never wrap them in <svelte:head> itself — that produces nested tags and the importer rejects the site with a 500.",
	inputSchema: {
		type: "object",
		properties: {
			head_svelte: {
				type: "string",
				description: "Full contents of site/head.svelte. Pass an empty string if the site has no head file."
			}
		},
		required: ["head_svelte"],
		additionalProperties: false
	},
	outputSchema: validationOutputSchema
} as const;

export function validateSite(input: ValidateSiteInput): ValidationResult {
	if (input.head_svelte.trim().length === 0) {
		return resultFromErrors([]);
	}
	return resultFromErrors(validateSiteHead(input.head_svelte, "site/head.svelte"));
}

export function readValidateSiteInput(args: unknown): ValidateSiteInput {
	const record = requireRecord(args, validateSiteTool.name);
	return {
		head_svelte: requireString(record, "head_svelte", validateSiteTool.name)
	};
}
