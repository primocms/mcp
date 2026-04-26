import {
	resolveFieldValue as runResolveFieldValue,
	type ResolveFieldValueResult
} from "../validators/field-shapes.js";
import { requireRecord, requireString } from "./validation_schemas.js";

export type ResolveFieldValueInput = {
	type: string;
	raw: unknown;
};

export const resolveFieldValueTool = {
	name: "resolve_field_value",
	description:
		"Convert a raw value into the canonical Primo content shape for a field type. Non-array repeater values are wrapped in an array with a warning.",
	inputSchema: {
		type: "object",
		properties: {
			type: {
				type: "string",
				description: "Primo field type, e.g. link, image, text, repeater, or group."
			},
			raw: {
				description: "Raw value to normalize."
			}
		},
		required: ["type", "raw"],
		additionalProperties: false
	},
	outputSchema: {
		type: "object",
		properties: {
			canonical: {
				description: "Canonical value to write into Primo YAML."
			},
			warnings: {
				type: "array",
				items: { type: "string" }
			}
		},
		required: ["canonical", "warnings"],
		additionalProperties: false
	}
} as const;

export function resolveFieldValue(input: ResolveFieldValueInput): ResolveFieldValueResult {
	return runResolveFieldValue(input.type, input.raw);
}

export function readResolveFieldValueInput(args: unknown): ResolveFieldValueInput {
	const record = requireRecord(args, resolveFieldValueTool.name);

	if (!("raw" in record)) {
		throw new TypeError('resolve_field_value requires an argument named "raw".');
	}

	return {
		type: requireString(record, "type", resolveFieldValueTool.name),
		raw: record.raw
	};
}
