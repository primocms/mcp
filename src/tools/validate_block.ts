import { validateBlockFromDisk, type ValidateBlockOnDiskInput } from "../validators/block.js";
import type { ValidationResult } from "../validators/types.js";
import { requireRecord, requireString, validationOutputSchema } from "./validation_schemas.js";

export const validateBlockTool = {
	name: "validate_block",
	description:
		"Validate a Primo block by reading blocks/{name}/component.svelte, config.yaml, fields.yaml, and content.yaml from disk. Errors if component.svelte, config.yaml, or fields.yaml is missing or empty (content.yaml must exist but may be {}), and checks schema, cross-file consistency, Svelte 5 syntax, and that every content.yaml key matches a defined field. Because it reads the real files, it catches the most common failure — a block whose files were never written to disk — which inline validation cannot. To validate a block you are about to write (before it exists on disk), use scaffold_block, which produces files guaranteed to pass this check.",
	inputSchema: {
		type: "object",
		properties: {
			site_path: {
				type: "string",
				description: "Absolute path to the site export folder containing site.yaml and the blocks/ directory."
			},
			name: {
				type: "string",
				description: "Block folder name under blocks/, e.g. \"hero\" for blocks/hero/."
			}
		},
		required: ["site_path", "name"],
		additionalProperties: false
	},
	outputSchema: validationOutputSchema
} as const;

export function validateBlock(input: ValidateBlockOnDiskInput): Promise<ValidationResult> {
	return validateBlockFromDisk(input);
}

export function readValidateBlockInput(args: unknown): ValidateBlockOnDiskInput {
	const record = requireRecord(args, validateBlockTool.name);

	return {
		site_path: requireString(record, "site_path", validateBlockTool.name),
		name: requireString(record, "name", validateBlockTool.name)
	};
}
