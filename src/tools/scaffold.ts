import { dump } from "js-yaml";

import { validateBlock as runValidateBlock } from "../validators/block.js";
import { validateJsonSchema } from "../validators/schema.js";
import { resultFromErrors, type ValidationResult } from "../validators/types.js";
import { parseYamlDocument } from "../validators/yaml.js";
import { requireRecord, requireString, validationOutputSchema } from "./validation_schemas.js";

type FieldInput = {
	name: string;
	type: string;
	label?: string;
	config?: Record<string, unknown>;
	subfields?: SubfieldInput[];
};

type SubfieldInput = {
	name: string;
	type: string;
	label?: string;
	config?: Record<string, unknown>;
};

type PageTypeFieldInput = {
	name: string;
	type: string;
	label?: string;
};

type FieldYaml = {
	name: string;
	label: string;
	type: string;
	config?: Record<string, unknown>;
	subfields?: FieldYaml[];
};

type ScaffoldFile = {
	path: string;
	contents: string;
};

type ScaffoldFilesResult = {
	files: ScaffoldFile[];
};

type ScaffoldResult = ScaffoldFilesResult | ValidationResult;

type ScaffoldBlockInput = {
	name: string;
	display_name?: string;
	fields: FieldInput[];
};

type ScaffoldPageTypeInput = {
	name: string;
	display_name?: string;
	icon?: string;
	color?: string;
	allowed_blocks: string[];
	fields?: PageTypeFieldInput[];
};

const fieldTypes = [
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
] as const;

// Comment-only layout.yaml emitted for new page types. Shows the schema
// inline so agents/humans see what's possible without it being live config.
const emptyLayoutTemplate = `# Sections shared by every page of this type. Add blocks here to render
# the same header/footer across all pages of this type. Body sections are
# seeded onto each newly created page of this type (and locked when the type
# has no allowed_blocks).
#
# header:
#   - block: site-header
# body:
#   - block: hero
# footer:
#   - block: site-footer
`;

const fieldTypeSchema = {
	type: "string",
	enum: fieldTypes
} as const;

const configSchema = {
	type: "object",
	additionalProperties: true
} as const;

const subfieldInputSchema = {
	type: "object",
	properties: {
		name: { type: "string" },
		type: fieldTypeSchema,
		label: { type: "string" },
		config: configSchema
	},
	required: ["name", "type"],
	additionalProperties: false
} as const;

const blockFieldInputSchema = {
	type: "object",
	properties: {
		name: { type: "string" },
		type: fieldTypeSchema,
		label: { type: "string" },
		config: configSchema,
		subfields: {
			type: "array",
			items: subfieldInputSchema
		}
	},
	required: ["name", "type"],
	additionalProperties: false
} as const;

const pageTypeFieldInputSchema = {
	type: "object",
	properties: {
		name: { type: "string" },
		type: fieldTypeSchema,
		label: { type: "string" }
	},
	required: ["name", "type"],
	additionalProperties: false
} as const;

const scaffoldOutputSchema = {
	type: "object",
	properties: {
		files: {
			type: "array",
			items: {
				type: "object",
				properties: {
					path: { type: "string" },
					contents: { type: "string" }
				},
				required: ["path", "contents"],
				additionalProperties: false
			}
		},
		ok: validationOutputSchema.properties.ok,
		errors: validationOutputSchema.properties.errors
	},
	additionalProperties: false
} as const;

const serverResolvedFieldTypes = new Set(["page-field", "site-field", "page", "page-list", "info"]);

export const scaffoldBlockTool = {
	name: "scaffold_block",
	description:
		"Generate ready-to-write component.svelte, config.yaml, fields.yaml, and content.yaml files for a new Primo block. All four files are emitted; content.yaml seeds the editor sidebar preview and is required for every block.",
	inputSchema: {
		type: "object",
		properties: {
			name: {
				type: "string",
				description: 'Block folder name, e.g. "pricing-table". This is the stable key referenced by pages and page-type allowed_blocks; renaming the folder breaks references.'
			},
			display_name: {
				type: "string",
				description: "Human-readable block name (config.yaml `name`). Defaults to a titleized version of name."
			},
			fields: {
				type: "array",
				items: blockFieldInputSchema
			}
		},
		required: ["name", "fields"],
		additionalProperties: false
	},
	outputSchema: scaffoldOutputSchema
} as const;

export const scaffoldPageTypeTool = {
	name: "scaffold_page_type",
	description:
		"Generate ready-to-write page-types/{name}/config.yaml + page-types/{name}/fields.yaml + page-types/{name}/layout.yaml files for a new Primo page type. config.yaml holds the page type's editor metadata; fields.yaml is a bare list of page-level fields (the same shape as block fields.yaml and site/fields.yaml); layout.yaml is a comment-only stub that documents how to add shared header/footer sections and seed default body sections.",
	inputSchema: {
		type: "object",
		properties: {
			name: {
				type: "string",
				description: "Page type folder name. This is the stable key — renaming the folder breaks page references."
			},
			display_name: {
				type: "string",
				description: "Human-readable page type name. Defaults to a titleized version of name."
			},
			icon: {
				type: "string",
				description: 'Iconify icon name, e.g. "mdi:file-document-outline".'
			},
			color: {
				type: "string",
				pattern: "^#[0-9a-fA-F]{6}$",
				description: 'Hex color used by the editor UI to badge this page type. Pick from the Primo palette: #2B407D (navy, default), #5B8FA3, #87CEEB, #4A90E2, #6B9BD2, #2ECC71, #27AE60, #52C9DC, #9B59B6, #8E44AD, #E74C3C, #C0392B, #E67E22, #F39C12, #F1C40F, #1ABC9C, #16A085, #95A5A6, #34495E, #E91E63.'
			},
			allowed_blocks: {
				type: "array",
				items: { type: "string" },
				description: 'Block folder names allowed on this page type. Pass [] explicitly for a static page type.'
			},
			fields: {
				type: "array",
				items: pageTypeFieldInputSchema
			}
		},
		required: ["name", "allowed_blocks"],
		additionalProperties: false
	},
	outputSchema: scaffoldOutputSchema
} as const;

export function scaffoldBlock(input: ScaffoldBlockInput): ScaffoldResult {
	const displayName = input.display_name?.trim() || titleize(input.name);
	const fields = input.fields.map(normalizeField);
	const configYaml = dumpYaml({ name: displayName });
	const fieldsYaml = fields.length > 0 ? dumpYaml(fields) : "[]\n";
	const seededContent = seedContent(fields);
	const contentYaml = Object.keys(seededContent).length > 0 ? dumpYaml(seededContent) : "{}\n";
	const componentSvelte = renderBlockComponent(fields);

	const files: ScaffoldFile[] = [
		{
			path: `blocks/${input.name}/component.svelte`,
			contents: componentSvelte
		},
		{
			path: `blocks/${input.name}/config.yaml`,
			contents: configYaml
		},
		{
			path: `blocks/${input.name}/fields.yaml`,
			contents: fieldsYaml
		},
		{
			path: `blocks/${input.name}/content.yaml`,
			contents: contentYaml
		}
	];

	const validation = runValidateBlock({
		name: input.name,
		component_svelte: componentSvelte,
		config_yaml: configYaml,
		fields_yaml: fieldsYaml,
		content_yaml: contentYaml
	});

	if (!validation.ok) {
		return validation;
	}

	return { files };
}

export function scaffoldPageType(input: ScaffoldPageTypeInput): ScaffoldResult {
	const displayName = input.display_name?.trim() || titleize(input.name);
	const fields = input.fields?.map((field) => normalizeField(field)) ?? [];
	const config: Record<string, unknown> = {
		name: displayName
	};

	if (input.icon !== undefined) {
		config.icon = input.icon;
	}

	if (input.color !== undefined) {
		config.color = input.color;
	}

	config.allowed_blocks = input.allowed_blocks;

	let configYaml = dumpYaml(config);
	if (input.allowed_blocks.length === 0) {
		configYaml = configYaml.replace(
			/^allowed_blocks:/m,
			"# Empty allowed_blocks makes this a static page type.\nallowed_blocks:"
		);
	}

	const fieldsYaml = fields.length > 0 ? dumpYaml(fields) : "[]\n";

	const configPath = `page-types/${input.name}/config.yaml`;
	const fieldsPath = `page-types/${input.name}/fields.yaml`;

	const parsedConfig = parseYamlDocument(configYaml, configPath);
	if (!parsedConfig.ok) {
		return resultFromErrors([parsedConfig.error]);
	}

	const configErrors = validateJsonSchema("page-type-config", parsedConfig.value, configPath);
	if (configErrors.length > 0) {
		return resultFromErrors(configErrors);
	}

	const parsedFields = parseYamlDocument(fieldsYaml, fieldsPath);
	if (!parsedFields.ok) {
		return resultFromErrors([parsedFields.error]);
	}

	const fieldsErrors = validateJsonSchema("page-type-fields", parsedFields.value, fieldsPath);
	if (fieldsErrors.length > 0) {
		return resultFromErrors(fieldsErrors);
	}

	return {
		files: [
			{
				path: configPath,
				contents: configYaml
			},
			{
				path: fieldsPath,
				contents: fieldsYaml
			},
			{
				path: `page-types/${input.name}/layout.yaml`,
				contents: emptyLayoutTemplate
			}
		]
	};
}

export function readScaffoldBlockInput(args: unknown): ScaffoldBlockInput {
	const record = requireRecord(args, scaffoldBlockTool.name);
	const name = requireString(record, "name", scaffoldBlockTool.name);
	assertSafePathSegment(name, "scaffold_block name");

	const displayName = readOptionalString(record, "display_name", scaffoldBlockTool.name);
	const fields = readFieldArray(record.fields, "scaffold_block fields", true);

	return {
		name,
		display_name: displayName,
		fields
	};
}

export function readScaffoldPageTypeInput(args: unknown): ScaffoldPageTypeInput {
	const record = requireRecord(args, scaffoldPageTypeTool.name);
	const name = requireString(record, "name", scaffoldPageTypeTool.name);
	assertSafePathSegment(name, "scaffold_page_type name");

	const allowedBlocks = readStringArray(record.allowed_blocks, "scaffold_page_type allowed_blocks");
	for (const blockName of allowedBlocks) {
		assertSafePathSegment(blockName, "scaffold_page_type allowed_blocks item");
	}

	const fields = record.fields === undefined ? undefined : readPageTypeFieldArray(record.fields);

	return {
		name,
		display_name: readOptionalString(record, "display_name", scaffoldPageTypeTool.name),
		icon: readOptionalString(record, "icon", scaffoldPageTypeTool.name),
		color: readOptionalString(record, "color", scaffoldPageTypeTool.name),
		allowed_blocks: allowedBlocks,
		fields
	};
}

function normalizeField(field: FieldInput | PageTypeFieldInput): FieldYaml {
	const normalized: FieldYaml = {
		name: field.name,
		label: field.label?.trim() || titleize(field.name),
		type: field.type
	};

	const config = "config" in field ? field.config : undefined;
	const defaultConfig = defaultConfigForField(field);
	if (config !== undefined) {
		normalized.config = config;
	} else if (defaultConfig) {
		normalized.config = defaultConfig;
	}

	if ("subfields" in field && field.subfields !== undefined) {
		normalized.subfields = field.subfields.map(normalizeField);
	}

	return normalized;
}

function defaultConfigForField(field: { name: string; type: string }): Record<string, unknown> | undefined {
	if (field.type === "page" || field.type === "page-list") {
		return { page_type: "default" };
	}

	if (field.type === "page-field" || field.type === "site-field") {
		return { field: field.name };
	}

	return undefined;
}

function seedContent(fields: FieldYaml[]): Record<string, unknown> {
	const content: Record<string, unknown> = {};

	for (const field of fields) {
		if (serverResolvedFieldTypes.has(field.type)) {
			continue;
		}
		content[field.name] = seedFieldValue(field);
	}

	return content;
}

function seedFieldValue(field: FieldYaml): unknown {
	switch (field.type) {
		case "link":
			return { url: "", label: "" };
		case "image":
			return { url: "", alt: "" };
		case "repeater":
			return [];
		case "group": {
			const value: Record<string, unknown> = {};
			for (const subfield of field.subfields ?? []) {
				if (!serverResolvedFieldTypes.has(subfield.type)) {
					value[subfield.name] = seedFieldValue(subfield);
				}
			}
			return value;
		}
		case "number":
		case "slider":
			return 0;
		case "switch":
			return false;
		default:
			return "";
	}
}

function renderBlockComponent(fields: FieldYaml[]): string {
	const props = fields.map((field) => field.name).join(", ");
	const propLine = props.length > 0 ? `let { ${props} } = $props();` : "let {} = $props();";
	const body =
		fields.length > 0 ? fields.map((field) => renderTopLevelField(field)).join("\n\n") : "\t<p>No fields configured.</p>";

	return `<script>
\t${propLine}
</script>

<section class="block">
${body}
</section>

<style>
\t.block {
\t\tdisplay: grid;
\t\tgap: 1rem;
\t}

\t.item,
\t.group {
\t\tdisplay: grid;
\t\tgap: 0.5rem;
\t}

\timg {
\t\tmax-width: 100%;
\t\theight: auto;
\t}
</style>
`;
}

function renderTopLevelField(field: FieldYaml): string {
	if (field.type === "repeater") {
		return renderRepeater(field);
	}

	if (field.type === "group") {
		return renderGroup(field);
	}

	if (field.type === "info") {
		return `\t<!-- ${field.name} is an editor-only info field. -->`;
	}

	return renderFieldElement(field, field.name, field.name, "\t");
}

function renderRepeater(field: FieldYaml): string {
	const itemName = `${field.name}_item`;
	const subfields = field.subfields ?? [];
	const itemBody =
		subfields.length > 0
			? subfields.map((subfield) => renderFieldElement(subfield, `${itemName}?.${subfield.name}`, subfield.name, "\t\t")).join("\n")
			: `\t\t<p data-key="${field.name}">${escapeHtml(field.label)} item</p>`;

	return `\t{#each ${field.name} ?? [] as ${itemName}}
\t\t<div class="item">
${itemBody}
\t\t</div>
\t{:else}
\t\t<p data-key="${field.name}">Add ${escapeHtml(field.label)}</p>
\t{/each}`;
}

function renderGroup(field: FieldYaml): string {
	const subfields = field.subfields ?? [];
	const groupBody =
		subfields.length > 0
			? subfields.map((subfield) => renderFieldElement(subfield, `${field.name}?.${subfield.name}`, subfield.name, "\t\t")).join("\n")
			: `\t\t<p data-key="${field.name}">${escapeHtml(field.label)}</p>`;

	return `\t<div class="group">
${groupBody}
\t</div>`;
}

function renderFieldElement(field: FieldYaml, valueAccess: string, dataKey: string, indent: string): string {
	const label = JSON.stringify(field.label);

	switch (field.type) {
		case "image":
			return `${indent}{#if ${valueAccess}?.url}
${indent}\t<img src={${valueAccess}?.url} alt={${valueAccess}?.alt ?? ""} data-key="${dataKey}" />
${indent}{/if}`;
		case "link":
			return `${indent}<a href={${valueAccess}?.url || "#"} data-key="${dataKey}">{${valueAccess}?.label || ${label}}</a>`;
		case "rich-text":
		case "markdown":
			return `${indent}<div data-key="${dataKey}">{@html ${valueAccess} ?? ""}</div>`;
		case "icon":
			return `${indent}{#if ${valueAccess}}
${indent}\t<div data-key="${dataKey}">{@html ${valueAccess}}</div>
${indent}{:else}
${indent}\t<p data-key="${dataKey}">${escapeHtml(field.label)}</p>
${indent}{/if}`;
		case "url":
			return `${indent}<a href={${valueAccess} || "#"} data-key="${dataKey}">{${valueAccess} || ${label}}</a>`;
		case "page":
			return `${indent}<a href={${valueAccess}?._meta?.url || "#"} data-key="${dataKey}">{${valueAccess}?.name || ${label}}</a>`;
		case "page-list":
			return `${indent}{#each ${valueAccess} ?? [] as ${field.name}_page}
${indent}\t<a href={${field.name}_page?._meta?.url || "#"} data-key="${dataKey}">{${field.name}_page?.name || ${label}}</a>
${indent}{/each}`;
		case "page-field":
		case "site-field":
			return `${indent}{#if ${valueAccess}?.url && "alt" in ${valueAccess}}
${indent}\t<img src={${valueAccess}.url} alt={${valueAccess}.alt ?? ""} data-key="${dataKey}" />
${indent}{:else if ${valueAccess}?.url}
${indent}\t<a href={${valueAccess}.url} data-key="${dataKey}">{${valueAccess}.label || ${label}}</a>
${indent}{:else}
${indent}\t<p data-key="${dataKey}">{${valueAccess} ?? ${label}}</p>
${indent}{/if}`;
		case "number":
		case "slider":
			return `${indent}<p data-key="${dataKey}">{${valueAccess} ?? 0}</p>`;
		case "switch":
			return `${indent}<p data-key="${dataKey}">{${valueAccess} ? "Enabled" : "Disabled"}</p>`;
		default:
			return `${indent}<p data-key="${dataKey}">{${valueAccess} ?? ${label}}</p>`;
	}
}

function dumpYaml(value: unknown): string {
	return dump(value, {
		lineWidth: -1,
		noRefs: true,
		sortKeys: false
	});
}

function titleize(value: string): string {
	const words = value
		.replace(/[_-]+/g, " ")
		.trim()
		.split(/\s+/)
		.filter(Boolean);

	if (words.length === 0) {
		return "Untitled";
	}

	return words.map((word) => word.slice(0, 1).toUpperCase() + word.slice(1)).join(" ");
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function readOptionalString(record: Record<string, unknown>, key: string, toolName: string): string | undefined {
	const value = record[key];
	if (value === undefined) {
		return undefined;
	}
	if (typeof value !== "string") {
		throw new TypeError(`${toolName} optional argument "${key}" must be a string when provided.`);
	}
	return value;
}

function readFieldArray(value: unknown, label: string, allowSubfields: boolean): FieldInput[] {
	if (!Array.isArray(value)) {
		throw new TypeError(`${label} must be an array.`);
	}

	return value.map((item, index) => readField(item, `${label}[${index}]`, allowSubfields));
}

function readPageTypeFieldArray(value: unknown): PageTypeFieldInput[] {
	if (!Array.isArray(value)) {
		throw new TypeError("scaffold_page_type fields must be an array when provided.");
	}

	return value.map((item, index) => {
		const field = readField(item, `scaffold_page_type fields[${index}]`, false);
		return {
			name: field.name,
			type: field.type,
			label: field.label
		};
	});
}

function readField(value: unknown, label: string, allowSubfields: boolean): FieldInput {
	const record = requireRecord(value, label);
	const name = requireString(record, "name", label);
	assertIdentifier(name, `${label}.name`);

	const field: FieldInput = {
		name,
		type: requireString(record, "type", label),
		label: readOptionalString(record, "label", label),
		config: readOptionalConfig(record, "config", label)
	};

	if (record.subfields !== undefined) {
		if (!allowSubfields) {
			throw new TypeError(`${label}.subfields is not supported here.`);
		}
		field.subfields = readFieldArray(record.subfields, `${label}.subfields`, false);
	}

	return field;
}

function readOptionalConfig(record: Record<string, unknown>, key: string, label: string): Record<string, unknown> | undefined {
	const value = record[key];
	if (value === undefined) {
		return undefined;
	}
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new TypeError(`${label}.${key} must be an object when provided.`);
	}
	return value as Record<string, unknown>;
}

function readStringArray(value: unknown, label: string): string[] {
	if (!Array.isArray(value)) {
		throw new TypeError(`${label} must be an array.`);
	}

	return value.map((item, index) => {
		if (typeof item !== "string") {
			throw new TypeError(`${label}[${index}] must be a string.`);
		}
		return item;
	});
}

function assertIdentifier(value: string, label: string): void {
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
		throw new TypeError(`${label} must be a valid Primo field name: letters, numbers, and underscores, starting with a letter or underscore.`);
	}
}

function assertSafePathSegment(value: string, label: string): void {
	if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value)) {
		throw new TypeError(`${label} must be a folder name using only letters, numbers, underscores, and hyphens.`);
	}
}
