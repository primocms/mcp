import { readFileSync } from "node:fs";

import { Ajv2020 } from "ajv/dist/2020.js";
import type { AnySchema, ErrorObject, ValidateFunction } from "ajv";

import type { ValidationError } from "./types.js";

type SchemaName = "block-fields" | "page" | "page-type-config";

const schemaDirectory = new URL("../schemas/", import.meta.url);

function loadSchema(filename: string): AnySchema {
	return JSON.parse(readFileSync(new URL(filename, schemaDirectory), "utf8")) as AnySchema;
}

const ajv = new Ajv2020({
	allErrors: true,
	verbose: true,
	strict: false
});

const fieldSchema = loadSchema("field.schema.json");
ajv.addSchema(fieldSchema, "field.schema.json");

const validators: Record<SchemaName, ValidateFunction> = {
	"block-fields": ajv.compile(loadSchema("block-fields.schema.json")),
	page: ajv.compile(loadSchema("page.schema.json")),
	"page-type-config": ajv.compile(loadSchema("page-type-config.schema.json"))
};

export function validateJsonSchema(schemaName: SchemaName, value: unknown, file: string): ValidationError[] {
	const validate = validators[schemaName];
	const valid = validate(value);

	if (valid) {
		return [];
	}

	return (validate.errors ?? []).map((error) => ajvErrorToValidationError(error, file));
}

function ajvErrorToValidationError(error: ErrorObject, file: string): ValidationError {
	return {
		file,
		severity: "error",
		message: formatAjvMessage(error),
		fix_hint: fixHintForAjvError(error)
	};
}

function pointerParts(pointer: string): string[] {
	return pointer
		.split("/")
		.slice(1)
		.map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function ordinal(value: number): string {
	const mod100 = value % 100;
	if (mod100 >= 11 && mod100 <= 13) {
		return `${value}th`;
	}

	switch (value % 10) {
		case 1:
			return `${value}st`;
		case 2:
			return `${value}nd`;
		case 3:
			return `${value}rd`;
		default:
			return `${value}th`;
	}
}

function singular(collection: string): string {
	if (collection === "fields") {
		return "field";
	}
	if (collection === "subfields") {
		return "subfield";
	}
	if (collection === "sections") {
		return "section";
	}
	if (collection === "allowed_blocks") {
		return "allowed block";
	}
	if (collection.endsWith("s")) {
		return collection.slice(0, -1);
	}
	return collection;
}

function formatProperty(property: string): string {
	return /^[A-Za-z_][A-Za-z0-9_]*$/.test(property) ? property : JSON.stringify(property);
}

export function describeInstancePath(pointer: string): string {
	const parts = pointerParts(pointer);
	if (parts.length === 0) {
		return "the document";
	}

	let description = "the document";

	for (let index = 0; index < parts.length; index += 1) {
		const part = parts[index];
		const next = parts[index + 1];

		if (part === undefined || /^\d+$/.test(part)) {
			continue;
		}

		if (next !== undefined && /^\d+$/.test(next)) {
			const item = `${ordinal(Number(next) + 1)} ${singular(part)}`;
			description = description === "the document" ? `the ${item}` : `${description}'s ${item}`;
			index += 1;
			continue;
		}

		description = description === "the document" ? formatProperty(part) : `${description}'s ${formatProperty(part)}`;
	}

	return description;
}

function formatAjvMessage(error: ErrorObject): string {
	const where = describeInstancePath(error.instancePath);

	switch (error.keyword) {
		case "required": {
			const missing = String((error.params as { missingProperty?: string }).missingProperty ?? "required property");
			return `${where} is missing required property "${missing}".`;
		}
		case "additionalProperties": {
			const property = String((error.params as { additionalProperty?: string }).additionalProperty ?? "unknown");
			return `${where} has unsupported property "${property}".`;
		}
		case "type": {
			const expected = (error.params as { type?: string | string[] }).type;
			const expectedText = Array.isArray(expected) ? expected.join(" or ") : expected;
			return `${where} must be ${expectedText ?? "the expected type"}.`;
		}
		case "enum": {
			const allowed = (error.params as { allowedValues?: unknown[] }).allowedValues ?? [];
			const received = "data" in error ? `; got ${JSON.stringify((error as ErrorObject & { data?: unknown }).data)}` : "";
			return `${where} must be one of: ${allowed.map((value) => JSON.stringify(value)).join(", ")}${received}.`;
		}
		case "const": {
			const allowed = (error.params as { allowedValue?: unknown }).allowedValue;
			return `${where} must be ${JSON.stringify(allowed)}.`;
		}
		case "pattern":
			return `${where} uses an invalid format.`;
		case "minLength":
			return `${where} must not be empty.`;
		case "exclusiveMinimum":
		case "minimum":
		case "maximum":
		case "exclusiveMaximum":
			return `${where} is outside the allowed numeric range.`;
		case "uniqueItems":
			return `${where} contains duplicate values.`;
		case "anyOf":
		case "oneOf":
			return `${where} must match one of the documented Primo shapes.`;
		case "not":
			return `${where} includes a property that is not valid for this field type.`;
		case "if":
			return `${where} does not satisfy the schema branch for its field type.`;
		default:
			return `${where} ${error.message ?? "is invalid"}.`;
	}
}

function fixHintForAjvError(error: ErrorObject): string | undefined {
	switch (error.keyword) {
		case "required": {
			const missing = String((error.params as { missingProperty?: string }).missingProperty ?? "property");
			return `Add "${missing}" with the shape documented for this Primo file.`;
		}
		case "additionalProperties": {
			const property = String((error.params as { additionalProperty?: string }).additionalProperty ?? "unknown");
			return `Remove "${property}" or rename it to a supported key.`;
		}
		case "type":
			return "Change the YAML value to the expected type.";
		case "enum":
			return "Use one of the supported Primo field types.";
		case "pattern":
			return "Use a valid identifier: letters, numbers, and underscores, starting with a letter or underscore.";
		case "minLength":
			return "Provide a non-empty value.";
		case "uniqueItems":
			return "Remove duplicate entries.";
		case "anyOf":
		case "oneOf":
			return "Use the canonical shape from the Primo reference docs.";
		case "not":
			return "Remove fields or subfields that are only valid for a different field type.";
		case "if":
			return "Review the required config/options shape for this field type.";
		default:
			return undefined;
	}
}
