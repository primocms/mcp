import { validateBlock as runValidateBlock, type ValidateBlockInput } from "../validators/block.js";
import type { ValidationResult } from "../validators/types.js";
import { requireRecord, requireString, validationOutputSchema } from "./validation_schemas.js";

export const validateBlockTool = {
	name: "validate_block",
	description:
		"Validate a Primo block's component.svelte, fields.yaml, and optional content.yaml for schema, cross-file consistency, and Svelte 5 syntax.",
	inputSchema: {
		type: "object",
		properties: {
			name: {
				type: "string",
				description: "Block folder name, used in error messages."
			},
			component_svelte: {
				type: "string",
				description: "Full contents of blocks/{name}/component.svelte."
			},
			fields_yaml: {
				type: "string",
				description: "Full contents of blocks/{name}/fields.yaml."
			},
			content_yaml: {
				type: "string",
				description: "Optional full contents of blocks/{name}/content.yaml."
			}
		},
		required: ["name", "component_svelte", "fields_yaml"],
		additionalProperties: false
	},
	outputSchema: validationOutputSchema
} as const;

export function validateBlock(input: ValidateBlockInput): ValidationResult {
	return runValidateBlock(input);
}

export function readValidateBlockInput(args: unknown): ValidateBlockInput {
	const record = requireRecord(args, validateBlockTool.name);
	const contentYaml = record.content_yaml;

	if (contentYaml !== undefined && typeof contentYaml !== "string") {
		throw new TypeError('validate_block optional argument "content_yaml" must be a string when provided.');
	}

	return {
		name: requireString(record, "name", validateBlockTool.name),
		component_svelte: requireString(record, "component_svelte", validateBlockTool.name),
		fields_yaml: requireString(record, "fields_yaml", validateBlockTool.name),
		content_yaml: contentYaml
	};
}
