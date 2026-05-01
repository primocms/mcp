import { validateBlock as runValidateBlock, type ValidateBlockInput } from "../validators/block.js";
import type { ValidationResult } from "../validators/types.js";
import { requireRecord, requireString, validationOutputSchema } from "./validation_schemas.js";

export const validateBlockTool = {
	name: "validate_block",
	description:
		"Validate a Primo block's component.svelte, config.yaml, fields.yaml, and content.yaml for schema, cross-file consistency, and Svelte 5 syntax. All four files are required — content.yaml seeds the editor sidebar preview and must always exist alongside the block.",
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
			config_yaml: {
				type: "string",
				description: "Full contents of blocks/{name}/config.yaml (holds _id and display name)."
			},
			fields_yaml: {
				type: "string",
				description: "Full contents of blocks/{name}/fields.yaml (bare top-level list of field definitions)."
			},
			content_yaml: {
				type: "string",
				description: "Full contents of blocks/{name}/content.yaml (default values for the editor sidebar)."
			}
		},
		required: ["name", "component_svelte", "config_yaml", "fields_yaml", "content_yaml"],
		additionalProperties: false
	},
	outputSchema: validationOutputSchema
} as const;

export function validateBlock(input: ValidateBlockInput): ValidationResult {
	return runValidateBlock(input);
}

export function readValidateBlockInput(args: unknown): ValidateBlockInput {
	const record = requireRecord(args, validateBlockTool.name);

	return {
		name: requireString(record, "name", validateBlockTool.name),
		component_svelte: requireString(record, "component_svelte", validateBlockTool.name),
		config_yaml: requireString(record, "config_yaml", validateBlockTool.name),
		fields_yaml: requireString(record, "fields_yaml", validateBlockTool.name),
		content_yaml: requireString(record, "content_yaml", validateBlockTool.name)
	};
}
