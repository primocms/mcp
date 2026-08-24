import {
	fieldDefinitionsFromDocument,
	validateContentAgainstFields
} from "./field-shapes.js";
import { validateJsonSchema } from "./schema.js";
import { resultFromErrors, type FieldDefinition, type ValidationError, type ValidationResult } from "./types.js";
import { isPlainObject, parseYamlDocument } from "./yaml.js";

export type AvailableBlockInput = {
	name: string;
	fields_yaml: string;
};

export type ValidatePageInput = {
	page_path: string;
	page_yaml: string;
	page_type_yaml: string;
	page_type_fields_yaml: string;
	available_blocks: AvailableBlockInput[];
};

type AvailableBlock = {
	name: string;
	fields: FieldDefinition[];
};

export function validatePage(input: ValidatePageInput): ValidationResult {
	const errors: ValidationError[] = [];
	const pagePath = input.page_path || "pages/page.yaml";
	const genericPageTypeFile = "page-types/config.yaml";

	const parsedPageType = parseYamlDocument(input.page_type_yaml, genericPageTypeFile);
	if (!parsedPageType.ok) {
		return resultFromErrors([parsedPageType.error]);
	}

	const pageTypeConfigFile = pageTypeConfigPath(parsedPageType.value);
	const pageTypeFieldsFile = pageTypeFieldsPath(parsedPageType.value);
	const pageTypeSchemaErrors = validateJsonSchema("page-type-config", parsedPageType.value, pageTypeConfigFile);
	if (pageTypeSchemaErrors.length > 0) {
		return resultFromErrors(pageTypeSchemaErrors);
	}

	const parsedPageTypeFields = parseYamlDocument(input.page_type_fields_yaml, pageTypeFieldsFile);
	if (!parsedPageTypeFields.ok) {
		return resultFromErrors([parsedPageTypeFields.error]);
	}
	errors.push(...validateJsonSchema("page-type-fields", parsedPageTypeFields.value, pageTypeFieldsFile));

	const parsedPage = parseYamlDocument(input.page_yaml, pagePath);
	if (!parsedPage.ok) {
		return resultFromErrors([parsedPage.error]);
	}

	errors.push(...validateJsonSchema("page", parsedPage.value, pagePath));

	const page = isPlainObject(parsedPage.value) ? parsedPage.value : {};
	const pageType = isPlainObject(parsedPageType.value) ? parsedPageType.value : {};
	const pageTypeFields = fieldDefinitionsFromDocument(parsedPageTypeFields.value);
	const availableBlocks = parseAvailableBlocks(input.available_blocks, errors);

	errors.push(...validatePageTypeMatch(page, pageType, pagePath, pageTypeConfigFile));
	errors.push(...validatePageFields(page, pageTypeFields, pagePath, pageTypeFieldsFile));
	errors.push(...validateSections(page, availableBlocks, pagePath));

	return resultFromErrors(errors);
}

export function sanitizeFilename(name: string): string {
	return name.replace(/[\/\\: ]/g, "-").toLowerCase();
}

function pageTypeConfigPath(pageTypeDocument: unknown): string {
	if (isPlainObject(pageTypeDocument) && typeof pageTypeDocument.name === "string" && pageTypeDocument.name.length > 0) {
		return `page-types/${sanitizeFilename(pageTypeDocument.name)}/config.yaml`;
	}

	return "page-types/config.yaml";
}

function pageTypeFieldsPath(pageTypeDocument: unknown): string {
	if (isPlainObject(pageTypeDocument) && typeof pageTypeDocument.name === "string" && pageTypeDocument.name.length > 0) {
		return `page-types/${sanitizeFilename(pageTypeDocument.name)}/fields.yaml`;
	}

	return "page-types/fields.yaml";
}

function parseAvailableBlocks(inputs: AvailableBlockInput[], errors: ValidationError[]): Map<string, AvailableBlock> {
	const blocks = new Map<string, AvailableBlock>();

	for (const input of inputs) {
		const file = `blocks/${input.name}/fields.yaml`;
		const parsed = parseYamlDocument(input.fields_yaml, file);
		if (!parsed.ok) {
			errors.push(parsed.error);
			continue;
		}

		errors.push(...validateJsonSchema("block-fields", parsed.value, file));
		const fields = fieldDefinitionsFromDocument(parsed.value);
		const block = { name: input.name, fields };
		blocks.set(input.name, block);
		blocks.set(sanitizeFilename(input.name), block);
	}

	return blocks;
}

function validatePageTypeMatch(
	page: Record<string, unknown>,
	pageType: Record<string, unknown>,
	pagePath: string,
	pageTypeFile: string
): ValidationError[] {
	if (typeof page.page_type !== "string" || typeof pageType.name !== "string") {
		return [];
	}

	const validNames = new Set([pageType.name, sanitizeFilename(pageType.name)]);
	if (validNames.has(page.page_type)) {
		return [];
	}

	return [
		{
			file: pagePath,
			severity: "error",
			message: `page_type is "${page.page_type}", but ${pageTypeFile} defines "${pageType.name}".`,
			fix_hint: `Set page_type to "${sanitizeFilename(pageType.name)}" or "${pageType.name}".`
		}
	];
}

function validatePageFields(
	page: Record<string, unknown>,
	pageTypeFields: FieldDefinition[],
	pagePath: string,
	pageTypeFieldsFile: string
): ValidationError[] {
	if (!("fields" in page)) {
		return [];
	}

	return validateContentAgainstFields(page.fields, pageTypeFields, {
		file: pagePath,
		context: "top-level page fields",
		fieldsLabel: pageTypeFieldsFile
	});
}

function validateSections(
	page: Record<string, unknown>,
	availableBlocks: Map<string, AvailableBlock>,
	pagePath: string
): ValidationError[] {
	const errors: ValidationError[] = [];
	if (!Array.isArray(page.sections)) {
		return errors;
	}

	// allowed_blocks gates what content editors can *insert* via the sidebar palette
	// (enforced in the UI), not what may already exist in a page file. A block can be
	// added to allowed_blocks, placed on a page, then removed so editors can't add it
	// elsewhere (e.g. a hero used only on the home page), so we don't validate against it here.
	page.sections.forEach((section, index) => {
		const sectionNumber = index + 1;
		if (!isPlainObject(section)) {
			return;
		}

		const blockName = typeof section.block === "string" ? section.block : "";
		if (blockName.length === 0) {
			return;
		}

		const block = resolveAvailableBlock(blockName, availableBlocks);
		if (!block) {
			errors.push({
				file: pagePath,
				severity: "error",
				message: `Section ${sectionNumber} uses block "${blockName}", but no blocks/${blockName}/ exists in the site. The section will render empty.`,
				fix_hint: `Create blocks/${blockName}/ (e.g. with scaffold_block) or change the section block name to an existing block.`
			});
			return;
		}

		if ("content" in section) {
			errors.push(
				...validateContentAgainstFields(section.content, block.fields, {
					file: pagePath,
					context: `section ${sectionNumber} (${block.name}) content`,
					fieldsLabel: `blocks/${block.name}/fields.yaml`
				})
			);
		}
	});

	return errors;
}

function resolveAvailableBlock(blockName: string, blocks: Map<string, AvailableBlock>): AvailableBlock | undefined {
	return blocks.get(blockName) ?? blocks.get(sanitizeFilename(blockName));
}
