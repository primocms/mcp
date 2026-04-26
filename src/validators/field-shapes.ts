import type { FieldDefinition, FieldType, ValidationError } from "./types.js";
import { describeValueType, isPlainObject } from "./yaml.js";

type ContentValidationOptions = {
	file: string;
	context: string;
	fieldsLabel?: string;
};

export type ResolveFieldValueResult = {
	canonical: unknown;
	warnings: string[];
};

const knownFieldTypes = new Set<string>([
	"repeater",
	"group",
	"text",
	"rich-text",
	"markdown",
	"link",
	"image",
	"icon",
	"url",
	"page-field",
	"site-field",
	"page",
	"page-list",
	"number",
	"date",
	"slider",
	"switch",
	"select",
	"info"
]);

const serverResolvedFieldTypes = new Set<string>(["page", "page-list", "page-field", "site-field", "info"]);

export function fieldDefinitionsFromDocument(document: unknown): FieldDefinition[] {
	if (!isPlainObject(document) || !Array.isArray(document.fields)) {
		return [];
	}

	return normalizeFieldDefinitions(document.fields);
}

export function normalizeFieldDefinitions(value: unknown): FieldDefinition[] {
	if (!Array.isArray(value)) {
		return [];
	}

	const fields: FieldDefinition[] = [];

	for (const item of value) {
		if (!isPlainObject(item) || typeof item.name !== "string" || typeof item.type !== "string") {
			continue;
		}

		fields.push({
			name: item.name,
			type: item.type,
			label: typeof item.label === "string" ? item.label : undefined,
			config: item.config,
			options: item.options,
			subfields: normalizeFieldDefinitions(item.subfields)
		});
	}

	return fields;
}

export function topLevelFieldNames(fields: FieldDefinition[]): Set<string> {
	return new Set(fields.map((field) => field.name));
}

export function editableDataKeyNames(fields: FieldDefinition[]): Set<string> {
	const names = new Set<string>();

	function visit(field: FieldDefinition, includeSelf: boolean) {
		if (includeSelf) {
			names.add(field.name);
		}

		if (field.type === "group" || field.type === "repeater") {
			for (const subfield of field.subfields ?? []) {
				visit(subfield, true);
			}
		}
	}

	for (const field of fields) {
		visit(field, true);
	}

	return names;
}

export function validatePageAndSiteFieldConfigs(fields: FieldDefinition[], file: string): ValidationError[] {
	const errors: ValidationError[] = [];

	function visit(field: FieldDefinition, path: string) {
		if (field.type === "page-field" || field.type === "site-field") {
			const config = field.config ?? field.options;
			const hasField =
				isPlainObject(config) && typeof config.field === "string" && config.field.trim().length > 0;

			if (!hasField) {
				errors.push({
					file,
					severity: "error",
					message: `${path} is a ${field.type} field but does not set config.field.`,
					fix_hint: `Add config.field with the target ${field.type === "page-field" ? "page-type" : "site"} field name.`
				});
			}
		}

		for (const subfield of field.subfields ?? []) {
			visit(subfield, `${path}.${subfield.name}`);
		}
	}

	for (const field of fields) {
		visit(field, field.name);
	}

	return errors;
}

export function validateContentAgainstFields(
	content: unknown,
	fields: FieldDefinition[],
	options: ContentValidationOptions
): ValidationError[] {
	if (content === undefined || content === null) {
		return [];
	}

	if (!isPlainObject(content)) {
		return [
			{
				file: options.file,
				severity: "error",
				message: `${options.context} must be a YAML object whose keys match field names.`,
				fix_hint: "Use an object like { field_name: value }."
			}
		];
	}

	return validateObjectAgainstFields(content, fields, options, options.context);
}

function validateObjectAgainstFields(
	content: Record<string, unknown>,
	fields: FieldDefinition[],
	options: ContentValidationOptions,
	context: string
): ValidationError[] {
	const errors: ValidationError[] = [];
	const fieldsByName = new Map(fields.map((field) => [field.name, field]));
	const fieldsLabel = options.fieldsLabel ?? "fields.yaml";

	for (const key of Object.keys(content)) {
		const field = fieldsByName.get(key);
		if (!field) {
			errors.push({
				file: options.file,
				severity: "error",
				message: `${context} key "${key}" is not defined in ${fieldsLabel}.`,
				fix_hint: `Remove "${key}" or add a matching field definition.`
			});
			continue;
		}

		errors.push(...validateFieldValue(content[key], field, options, `${context}.${key}`));
	}

	return errors;
}

function validateFieldValue(
	value: unknown,
	field: FieldDefinition,
	options: ContentValidationOptions,
	context: string
): ValidationError[] {
	const errors: ValidationError[] = [];

	if (!knownFieldTypes.has(field.type)) {
		return [
			{
				file: options.file,
				severity: "error",
				message: `${field.name} uses unknown field type "${field.type}".`,
				fix_hint: "Use one of the supported Primo field types from the field-types reference."
			}
		];
	}

	if (value === null || value === undefined || serverResolvedFieldTypes.has(field.type)) {
		return [];
	}

	switch (field.type) {
		case "link":
			return validateLinkValue(value, options.file, context);
		case "image":
			return validateImageValue(value, options.file, context);
		case "repeater":
			return validateRepeaterValue(value, field, options, context);
		case "group":
			return validateGroupValue(value, field, options, context);
		case "number":
		case "slider":
			if (typeof value !== "number") {
				errors.push(expectedTypeError(options.file, context, "number", value));
			}
			return errors;
		case "switch":
			if (typeof value !== "boolean") {
				errors.push(expectedTypeError(options.file, context, "boolean", value));
			}
			return errors;
		case "rich-text":
			if (typeof value !== "string" && !isPlainObject(value)) {
				errors.push(expectedTypeError(options.file, context, "string or TipTap JSON object", value));
			}
			return errors;
		case "text":
			if (!isScalar(value)) {
				errors.push(expectedTypeError(options.file, context, "scalar text value", value));
			}
			return errors;
		case "markdown":
		case "url":
		case "select":
		case "icon":
			if (typeof value !== "string") {
				errors.push(expectedTypeError(options.file, context, "string", value));
			}
			return errors;
		case "date":
			if (typeof value !== "string" && !(value instanceof Date)) {
				errors.push(expectedTypeError(options.file, context, "date string", value));
			}
			return errors;
		default:
			return errors;
	}
}

function isScalar(value: unknown): boolean {
	return value === null || ["string", "number", "boolean"].includes(typeof value) || value instanceof Date;
}

function expectedTypeError(file: string, context: string, expected: string, value: unknown): ValidationError {
	return {
		file,
		severity: "error",
		message: `${context} must be a ${expected}; got ${describeValueType(value)}.`,
		fix_hint: "Use resolve_field_value for the canonical value shape before writing YAML."
	};
}

function validateLinkValue(value: unknown, file: string, context: string): ValidationError[] {
	if (!isPlainObject(value)) {
		return [
			{
				file,
				severity: "error",
				message: `${context} must be a link object with url and label keys; got ${describeValueType(value)}.`,
				fix_hint: 'Use { url: "<href>", label: "<text>" }.'
			}
		];
	}

	const errors: ValidationError[] = [];
	for (const key of Object.keys(value)) {
		if (!["url", "label", "text", "page"].includes(key)) {
			errors.push({
				file,
				severity: "warning",
				message: `${context}.${key} is not part of the canonical link shape.`,
				fix_hint: 'Use only url, label, text, and page on link values.'
			});
		}
	}

	if ("url" in value && typeof value.url !== "string") {
		errors.push(expectedTypeError(file, `${context}.url`, "string", value.url));
	}
	if ("label" in value && typeof value.label !== "string") {
		errors.push(expectedTypeError(file, `${context}.label`, "string", value.label));
	}
	if ("text" in value && typeof value.text !== "string") {
		errors.push(expectedTypeError(file, `${context}.text`, "string", value.text));
	}
	if ("page" in value && value.page !== null && typeof value.page !== "string") {
		errors.push(expectedTypeError(file, `${context}.page`, "string or null", value.page));
	}
	if (!("url" in value)) {
		errors.push({
			file,
			severity: "warning",
			message: `${context} is missing url.`,
			fix_hint: "Add url when this link should render as clickable."
		});
	}

	return errors;
}

function validateImageValue(value: unknown, file: string, context: string): ValidationError[] {
	if (!isPlainObject(value)) {
		return [
			{
				file,
				severity: "error",
				message: `${context} must be an image object with url and alt keys; got ${describeValueType(value)}.`,
				fix_hint: 'Use { url: "<image-url>", alt: "<description>" }.'
			}
		];
	}

	const errors: ValidationError[] = [];
	for (const key of Object.keys(value)) {
		if (!["url", "alt", "width", "height", "upload"].includes(key)) {
			errors.push({
				file,
				severity: "warning",
				message: `${context}.${key} is not part of the canonical image shape.`,
				fix_hint: "Use only url, alt, width, height, and upload on image values."
			});
		}
	}

	if ("url" in value && typeof value.url !== "string") {
		errors.push(expectedTypeError(file, `${context}.url`, "string", value.url));
	}
	if ("alt" in value && typeof value.alt !== "string") {
		errors.push(expectedTypeError(file, `${context}.alt`, "string", value.alt));
	}
	if ("width" in value && value.width !== null && typeof value.width !== "number") {
		errors.push(expectedTypeError(file, `${context}.width`, "number or null", value.width));
	}
	if ("height" in value && value.height !== null && typeof value.height !== "number") {
		errors.push(expectedTypeError(file, `${context}.height`, "number or null", value.height));
	}
	if (!("url" in value)) {
		errors.push({
			file,
			severity: "warning",
			message: `${context} is missing url.`,
			fix_hint: "Add url when this image should render."
		});
	}

	return errors;
}

function validateRepeaterValue(
	value: unknown,
	field: FieldDefinition,
	options: ContentValidationOptions,
	context: string
): ValidationError[] {
	if (!Array.isArray(value)) {
		return [
			{
				file: options.file,
				severity: "error",
				message: `${context} must be an array of objects for repeater field "${field.name}"; got ${describeValueType(value)}.`,
				fix_hint: "Use a YAML list where each item contains the repeater subfield keys."
			}
		];
	}

	const errors: ValidationError[] = [];

	value.forEach((item, index) => {
		if (!isPlainObject(item)) {
			errors.push({
				file: options.file,
				severity: "error",
				message: `${context}[${index}] must be an object; got ${describeValueType(item)}.`,
				fix_hint: "Each repeater item should be a YAML object keyed by subfield name."
			});
			return;
		}

		errors.push(
			...validateObjectAgainstFields(item, field.subfields ?? [], options, `${context}[${index}]`)
		);
	});

	return errors;
}

function validateGroupValue(
	value: unknown,
	field: FieldDefinition,
	options: ContentValidationOptions,
	context: string
): ValidationError[] {
	if (!isPlainObject(value)) {
		return [
			{
				file: options.file,
				severity: "error",
				message: `${context} must be an object for group field "${field.name}"; got ${describeValueType(value)}.`,
				fix_hint: "Use a YAML object keyed by group subfield name."
			}
		];
	}

	return validateObjectAgainstFields(value, field.subfields ?? [], options, context);
}

export function resolveFieldValue(type: string, raw: unknown): ResolveFieldValueResult {
	const warnings: string[] = [];

	if (!knownFieldTypes.has(type)) {
		return {
			canonical: raw,
			warnings: [`Unknown field type "${type}"; leaving value unchanged.`]
		};
	}

	switch (type as FieldType) {
		case "link":
			return resolveLink(raw);
		case "image":
			return resolveImage(raw);
		case "icon":
			if (typeof raw === "string") {
				return { canonical: raw, warnings };
			}
			warnings.push(`Expected icon to be a string; stringified ${describeValueType(raw)}.`);
			return { canonical: String(raw), warnings };
		case "repeater":
			if (Array.isArray(raw)) {
				return { canonical: raw, warnings };
			}
			warnings.push(`Expected repeater to be an array; wrapped ${describeValueType(raw)} in an array.`);
			return { canonical: raw === undefined ? [] : [raw], warnings };
		case "group":
			if (isPlainObject(raw)) {
				return { canonical: raw, warnings };
			}
			warnings.push(`Expected group to be an object; replaced ${describeValueType(raw)} with an empty object.`);
			return { canonical: {}, warnings };
		case "number":
		case "slider":
			if (typeof raw !== "number") {
				warnings.push(`Expected ${type} to be a number; got ${describeValueType(raw)}.`);
			}
			return { canonical: raw, warnings };
		case "switch":
			if (typeof raw !== "boolean") {
				warnings.push(`Expected switch to be a boolean; got ${describeValueType(raw)}.`);
			}
			return { canonical: raw, warnings };
		case "text":
		case "markdown":
		case "rich-text":
		case "url":
		case "select":
		case "date":
			if (typeof raw !== "string") {
				warnings.push(`Expected ${type} to be a string; got ${describeValueType(raw)}.`);
			}
			return { canonical: raw, warnings };
		case "page":
		case "page-list":
		case "page-field":
		case "site-field":
		case "info":
			return { canonical: raw, warnings };
		default:
			return { canonical: raw, warnings };
	}
}

function resolveLink(raw: unknown): ResolveFieldValueResult {
	const warnings: string[] = [];

	if (typeof raw === "string") {
		warnings.push("Converted string link value to { url, label }.");
		return {
			canonical: { url: raw, label: "" },
			warnings
		};
	}

	if (!isPlainObject(raw)) {
		warnings.push(`Expected link to be an object; leaving ${describeValueType(raw)} unchanged.`);
		return { canonical: raw, warnings };
	}

	if (!("url" in raw)) {
		warnings.push("Link object is missing url; leaving value unchanged.");
		return { canonical: raw, warnings };
	}

	const canonical: Record<string, unknown> = {
		url: raw.url,
		label: typeof raw.label === "string" ? raw.label : ""
	};

	if (typeof raw.url !== "string") {
		warnings.push(`Expected link.url to be a string; got ${describeValueType(raw.url)}.`);
	}
	if ("label" in raw && typeof raw.label !== "string") {
		warnings.push(`Expected link.label to be a string; replaced ${describeValueType(raw.label)} with empty label.`);
	}
	if (typeof raw.text === "string") {
		canonical.text = raw.text;
	}
	if (typeof raw.page === "string" || raw.page === null) {
		canonical.page = raw.page;
	}

	const stripped = Object.keys(raw).filter((key) => !["url", "label", "text", "page"].includes(key));
	if (stripped.length > 0) {
		warnings.push(`Stripped unsupported link key${stripped.length === 1 ? "" : "s"}: ${stripped.join(", ")}.`);
	}

	return { canonical, warnings };
}

function resolveImage(raw: unknown): ResolveFieldValueResult {
	const warnings: string[] = [];

	if (typeof raw === "string") {
		warnings.push("Converted string image value to { url, alt }.");
		return {
			canonical: { url: raw, alt: "" },
			warnings
		};
	}

	if (!isPlainObject(raw)) {
		warnings.push(`Expected image to be an object; leaving ${describeValueType(raw)} unchanged.`);
		return { canonical: raw, warnings };
	}

	if (!("url" in raw)) {
		warnings.push("Image object is missing url; leaving value unchanged.");
		return { canonical: raw, warnings };
	}

	const canonical: Record<string, unknown> = {
		url: raw.url,
		alt: typeof raw.alt === "string" ? raw.alt : ""
	};

	if (typeof raw.url !== "string") {
		warnings.push(`Expected image.url to be a string; got ${describeValueType(raw.url)}.`);
	}
	if ("alt" in raw && typeof raw.alt !== "string") {
		warnings.push(`Expected image.alt to be a string; replaced ${describeValueType(raw.alt)} with empty alt.`);
	}
	if (typeof raw.width === "number" || raw.width === null) {
		canonical.width = raw.width;
	}
	if (typeof raw.height === "number" || raw.height === null) {
		canonical.height = raw.height;
	}

	const stripped = Object.keys(raw).filter((key) => !["url", "alt", "width", "height"].includes(key));
	if (stripped.length > 0) {
		warnings.push(`Stripped unsupported image key${stripped.length === 1 ? "" : "s"}: ${stripped.join(", ")}.`);
	}

	return { canonical, warnings };
}
