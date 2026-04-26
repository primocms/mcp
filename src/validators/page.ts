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

	const pageTypeFile = pageTypeConfigPath(parsedPageType.value);
	const pageTypeSchemaErrors = validateJsonSchema("page-type-config", parsedPageType.value, pageTypeFile);
	if (pageTypeSchemaErrors.length > 0) {
		return resultFromErrors(pageTypeSchemaErrors);
	}

	const parsedPage = parseYamlDocument(input.page_yaml, pagePath);
	if (!parsedPage.ok) {
		return resultFromErrors([parsedPage.error]);
	}

	errors.push(...validateJsonSchema("page", parsedPage.value, pagePath));

	const page = isPlainObject(parsedPage.value) ? parsedPage.value : {};
	const pageType = isPlainObject(parsedPageType.value) ? parsedPageType.value : {};
	const pageTypeFields = fieldDefinitionsFromDocument(pageType);
	const availableBlocks = parseAvailableBlocks(input.available_blocks, errors);

	errors.push(...validatePageTypeMatch(page, pageType, pagePath, pageTypeFile));
	errors.push(...validatePageFields(page, pageTypeFields, pagePath));
	errors.push(...validateSections(page, pageType, availableBlocks, pagePath));

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
	pagePath: string
): ValidationError[] {
	if (!("fields" in page)) {
		return [];
	}

	return validateContentAgainstFields(page.fields, pageTypeFields, {
		file: pagePath,
		context: "top-level page fields",
		fieldsLabel: "the page type fields"
	});
}

function validateSections(
	page: Record<string, unknown>,
	pageType: Record<string, unknown>,
	availableBlocks: Map<string, AvailableBlock>,
	pagePath: string
): ValidationError[] {
	const errors: ValidationError[] = [];
	if (!Array.isArray(page.sections)) {
		return errors;
	}

	const allowedBlocks =
		Array.isArray(pageType.allowed_blocks) && pageType.allowed_blocks.length > 0
			? new Set(pageType.allowed_blocks.filter((block): block is string => typeof block === "string"))
			: undefined;

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
				message: `Section ${sectionNumber} uses block "${blockName}", but available_blocks does not include that block.`,
				fix_hint: `Add "${blockName}" to the available_blocks input or change the section block name.`
			});
			return;
		}

		if (allowedBlocks && !allowedBlocks.has(block.name)) {
			errors.push({
				file: pagePath,
				severity: "error",
				message: `Section ${sectionNumber} uses block "${block.name}", but the page type does not allow that block.`,
				fix_hint: `Add "${block.name}" to allowed_blocks or use a block listed there.`
			});
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
