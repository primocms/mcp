import { validatePage as runValidatePage, type ValidatePageInput } from "../validators/page.js";
import type { ValidationResult } from "../validators/types.js";
import { requireRecord, requireString, validationOutputSchema } from "./validation_schemas.js";

export const validatePageTool = {
	name: "validate_page",
	description:
		"Validate a Primo page YAML file against its page type config and the available block field definitions.",
	inputSchema: {
		type: "object",
		properties: {
			page_path: {
				type: "string",
				description: 'Path used in messages, e.g. "pages/index.yaml".'
			},
			page_yaml: {
				type: "string",
				description: "Full contents of the page YAML file."
			},
			page_type_yaml: {
				type: "string",
				description: "Full contents of page-types/{page_type}/config.yaml."
			},
			available_blocks: {
				type: "array",
				items: {
					type: "object",
					properties: {
						name: {
							type: "string",
							description: "Block folder name."
						},
						fields_yaml: {
							type: "string",
							description: "Full contents of blocks/{name}/fields.yaml."
						}
					},
					required: ["name", "fields_yaml"],
					additionalProperties: false
				}
			}
		},
		required: ["page_path", "page_yaml", "page_type_yaml", "available_blocks"],
		additionalProperties: false
	},
	outputSchema: validationOutputSchema
} as const;

export function validatePage(input: ValidatePageInput): ValidationResult {
	return runValidatePage(input);
}

export function readValidatePageInput(args: unknown): ValidatePageInput {
	const record = requireRecord(args, validatePageTool.name);
	const availableBlocks = record.available_blocks;

	if (!Array.isArray(availableBlocks)) {
		throw new TypeError('validate_page requires an array argument named "available_blocks".');
	}

	return {
		page_path: requireString(record, "page_path", validatePageTool.name),
		page_yaml: requireString(record, "page_yaml", validatePageTool.name),
		page_type_yaml: requireString(record, "page_type_yaml", validatePageTool.name),
		available_blocks: availableBlocks.map((block, index) => {
			const blockRecord = requireRecord(block, `validate_page available_blocks[${index}]`);
			return {
				name: requireString(blockRecord, "name", `validate_page available_blocks[${index}]`),
				fields_yaml: requireString(blockRecord, "fields_yaml", `validate_page available_blocks[${index}]`)
			};
		})
	};
}
