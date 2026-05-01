import {
	editableDataKeyNames,
	fieldDefinitionsFromDocument,
	topLevelFieldNames,
	validateContentAgainstFields,
	validatePageAndSiteFieldConfigs
} from "./field-shapes.js";
import { validateJsonSchema } from "./schema.js";
import {
	extractDataKeyReferences,
	extractPropsDestructureNames,
	validateSvelte5Syntax
} from "./svelte.js";
import { resultFromErrors, type ValidationError, type ValidationResult } from "./types.js";
import { parseYamlDocument } from "./yaml.js";

export type ValidateBlockInput = {
	name: string;
	component_svelte: string;
	config_yaml: string;
	fields_yaml: string;
	content_yaml: string;
};

export function validateBlock(input: ValidateBlockInput): ValidationResult {
	const errors: ValidationError[] = [];
	const configFile = "config.yaml";
	const fieldsFile = "fields.yaml";
	const contentFile = "content.yaml";
	const componentFile = "component.svelte";

	const parsedConfig = parseYamlDocument(input.config_yaml, configFile);
	if (!parsedConfig.ok) {
		errors.push(parsedConfig.error);
	} else {
		errors.push(...validateJsonSchema("block-config", parsedConfig.value, configFile));
	}

	const parsedFields = parseYamlDocument(input.fields_yaml, fieldsFile);
	const fields = parsedFields.ok ? fieldDefinitionsFromDocument(parsedFields.value) : [];

	if (!parsedFields.ok) {
		errors.push(parsedFields.error);
	} else {
		errors.push(...validateJsonSchema("block-fields", parsedFields.value, fieldsFile));
		errors.push(...validatePageAndSiteFieldConfigs(fields, fieldsFile));
	}

	const parsedContent = parseYamlDocument(input.content_yaml, contentFile);
	if (!parsedContent.ok) {
		errors.push(parsedContent.error);
	} else if (parsedFields.ok) {
		errors.push(
			...validateContentAgainstFields(parsedContent.value, fields, {
				file: contentFile,
				context: "content.yaml"
			})
		);
	}

	if (parsedFields.ok) {
		errors.push(...validateBlockCrossFileReferences(input.name, input.component_svelte, fields));
	}

	errors.push(...validateSvelte5Syntax(input.component_svelte, componentFile));

	return resultFromErrors(errors);
}

// Field types whose values are meant to be inline-editable in the rendered
// page. Matches the list documented in inline-editing.md. Container types
// (repeater, group) and server-resolved types (page, page-list, etc.) don't
// inline-edit themselves; subfields of containers are checked recursively.
const inlineEditableFieldTypes = new Set<string>([
	"text",
	"rich-text",
	"markdown",
	"link",
	"image",
	"icon",
	"url",
	"number"
]);

function validateBlockCrossFileReferences(
	blockName: string,
	component: string,
	fields: ReturnType<typeof fieldDefinitionsFromDocument>
): ValidationError[] {
	const errors: ValidationError[] = [];
	const topLevelNames = topLevelFieldNames(fields);
	const dataKeyNames = editableDataKeyNames(fields);
	const dataKeysInComponent = new Set(extractDataKeyReferences(component).map(ref => ref.name));

	for (const fieldName of topLevelNames) {
		if (!containsIdentifier(component, fieldName)) {
			errors.push({
				file: "component.svelte",
				severity: "warning",
				message: `Field "${fieldName}" from ${blockName}/fields.yaml is not referenced in component.svelte.`,
				fix_hint: `Use "${fieldName}" in the component or remove the unused field definition.`
			});
		}
	}

	for (const propName of extractPropsDestructureNames(component)) {
		if (!topLevelNames.has(propName)) {
			errors.push({
				file: "component.svelte",
				severity: "error",
				message: `$props() destructures "${propName}", but ${blockName}/fields.yaml does not define that field.`,
				fix_hint: `Add a "${propName}" field to fields.yaml or remove it from the $props() destructure.`
			});
		}
	}

	for (const reference of extractDataKeyReferences(component)) {
		if (!dataKeyNames.has(reference.name)) {
			errors.push({
				file: "component.svelte",
				severity: "warning",
				message: `data-key="${reference.name}" does not match a top-level field or repeater/group subfield in fields.yaml.`,
				fix_hint: "Use a field name from fields.yaml so inline editing can target the right content.",
				location: reference.location
			});
		}
	}

	for (const field of iterateInlineEditableFields(fields)) {
		if (!dataKeysInComponent.has(field.name) && containsIdentifier(component, field.name)) {
			errors.push({
				file: "component.svelte",
				severity: "warning",
				message: `Field "${field.name}" (${field.type}) is referenced but has no matching data-key="${field.name}" in component.svelte. Inline click-to-edit won't work.`,
				fix_hint: `Add data-key="${field.name}" to the element bound to ${field.name}, e.g. <h1 data-key="${field.name}">{${field.name}}</h1>.`
			});
		}
	}

	return errors;
}

function* iterateInlineEditableFields(
	fields: ReturnType<typeof fieldDefinitionsFromDocument>
): Generator<{ name: string; type: string }> {
	for (const field of fields) {
		if (field.type === "group" || field.type === "repeater") {
			yield* iterateInlineEditableFields(field.subfields ?? []);
			continue;
		}
		if (inlineEditableFieldTypes.has(field.type)) {
			yield { name: field.name, type: field.type };
		}
	}
}

function containsIdentifier(source: string, identifier: string): boolean {
	const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`(^|[^A-Za-z0-9_])${escaped}($|[^A-Za-z0-9_])`).test(source);
}
