import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { load as loadYaml } from "js-yaml";

import { validateJsonSchema } from "../dist/validators/schema.js";

// Fixture site to validate against. Provide via PRIMO_SMOKE_SITE or a CLI arg —
// no default, since the fixtures live outside this repo.
const siteRoot = process.env.PRIMO_SMOKE_SITE || process.argv[2];
if (!siteRoot) {
	console.error(
		"smoke-tests: set PRIMO_SMOKE_SITE=<path-to-site> or pass it as an argument\n" +
		"  e.g. PRIMO_SMOKE_SITE=../primo-sites/sites/coffee-shop npm run smoke"
	);
	process.exit(1);
}

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

function structured(result) {
	if (result.structuredContent) {
		return result.structuredContent;
	}

	const first = result.content?.find((item) => item.type === "text");
	assert(first, "Tool result did not include text content.");
	return JSON.parse(first.text);
}

function readBlock(name) {
	const blockRoot = join(siteRoot, "blocks", name);
	return {
		name,
		component_svelte: readFileSync(join(blockRoot, "component.svelte"), "utf8"),
		config_yaml: readFileSync(join(blockRoot, "config.yaml"), "utf8"),
		fields_yaml: readFileSync(join(blockRoot, "fields.yaml"), "utf8"),
		content_yaml: readFileSync(join(blockRoot, "content.yaml"), "utf8")
	};
}

function availableBlocks() {
	return readdirSync(join(siteRoot, "blocks"), { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => ({
			name: entry.name,
			fields_yaml: readFileSync(join(siteRoot, "blocks", entry.name, "fields.yaml"), "utf8")
		}));
}

function hasMessage(result, text) {
	return result.errors.some((error) => error.message.includes(text));
}

function fileMap(result) {
	assert(Array.isArray(result.files), "Expected scaffold result to include files.");
	return new Map(result.files.map((file) => [file.path, file.contents]));
}

const transport = new StdioClientTransport({
	command: "node",
	args: ["dist/index.js"],
	cwd: new URL("..", import.meta.url).pathname,
	stderr: "pipe"
});

const client = new Client({ name: "@primo/mcp-smoke", version: "0.1.0" });

try {
	await client.connect(transport);

	const tools = await client.listTools();
	const toolNames = new Set(tools.tools.map((tool) => tool.name));
	for (const tool of [
		"list_docs",
		"get_docs",
		"validate_block",
		"validate_page",
		"resolve_field_value",
		"scaffold_block",
		"scaffold_page_type"
	]) {
		assert(toolNames.has(tool), `Expected ${tool} in tool list.`);
	}
	console.log(`tool list: ${[...toolNames].sort().join(", ")}`);

	const docsList = structured(await client.callTool({ name: "list_docs", arguments: {} }));
	assert(docsList.sections.length >= 6, "Expected docs sections from list_docs.");
	const blocksDocs = structured(await client.callTool({ name: "get_docs", arguments: { section: "blocks" } }));
	assert(blocksDocs.markdown.includes("# Blocks"), "Expected blocks docs markdown.");
	console.log("docs tools: ok");

	const goodBlock = structured(await client.callTool({ name: "validate_block", arguments: readBlock("hero") }));
	assert(goodBlock.ok, `Expected hero block to validate: ${JSON.stringify(goodBlock.errors)}`);
	console.log("validate_block good fixture: ok");

	const goodPage = structured(
		await client.callTool({
			name: "validate_page",
			arguments: {
				page_path: "pages/index.yaml",
				page_yaml: readFileSync(join(siteRoot, "pages", "index.yaml"), "utf8"),
				page_type_yaml: readFileSync(join(siteRoot, "page-types", "default", "config.yaml"), "utf8"),
				page_type_fields_yaml: readFileSync(join(siteRoot, "page-types", "default", "fields.yaml"), "utf8"),
				available_blocks: availableBlocks()
			}
		})
	);
	assert(goodPage.ok, `Expected index page to validate: ${JSON.stringify(goodPage.errors)}`);
	console.log("validate_page good fixture: ok");

	const brokenBlock = structured(
		await client.callTool({
			name: "validate_block",
			arguments: {
				name: "broken",
				config_yaml: `name: Broken
`,
				fields_yaml: `- name: headline
  type: text
- name: cta
  type: link
- name: target
  type: page-field
  config: {}
- name: mystery
  type: unknown-type
`,
				content_yaml: `cta: /book
extra: not defined
`,
				component_svelte: `<script>
  let { headline, missing_prop } = $props()
  $: doubled = headline + headline
</script>

<button on:click={() => {}} data-key="unknown">{headline}</button>
`
			}
		})
	);
	assert(!brokenBlock.ok, "Expected broken block to fail.");
	assert(hasMessage(brokenBlock, "unknown-type"), "Expected unknown field type error.");
	assert(hasMessage(brokenBlock, "config.field"), "Expected page-field config.field error.");
	assert(hasMessage(brokenBlock, "$props() destructures"), "Expected missing $props field error.");
	assert(hasMessage(brokenBlock, "link object"), "Expected bad link shape error.");
	assert(hasMessage(brokenBlock, "on:click"), "Expected Svelte on:click error.");
	console.log("validate_block broken fixture: ok");

	const brokenPage = structured(
		await client.callTool({
			name: "validate_page",
			arguments: {
				page_path: "pages/broken.yaml",
				page_type_yaml: `name: Blog Post
allowed_blocks:
  - hero
`,
				page_type_fields_yaml: `- name: seo_title
  type: text
`,
				page_yaml: `name: Broken
page_type: wrong-type
fields:
  unknown: nope
sections:
  - block: missing
    content: {}
  - block: hero
    content:
      cta: /bad-link
      extra: not defined
`,
				available_blocks: [
					{
						name: "hero",
						fields_yaml: `- name: cta
  type: link
`
					}
				]
			}
		})
	);
	assert(!brokenPage.ok, "Expected broken page to fail.");
	assert(hasMessage(brokenPage, "page_type"), "Expected page_type mismatch error.");
	assert(hasMessage(brokenPage, "unknown"), "Expected unknown page field error.");
	assert(hasMessage(brokenPage, "missing"), "Expected missing block error.");
	assert(hasMessage(brokenPage, "link object"), "Expected section bad link shape error.");
	console.log("validate_page broken fixture: ok");

	const resolvedLink = structured(
		await client.callTool({
			name: "resolve_field_value",
			arguments: {
				type: "link",
				raw: "/contact"
			}
		})
	);
	assert(resolvedLink.canonical.url === "/contact", "Expected link string to become canonical object.");
	assert(resolvedLink.canonical.label === "", "Expected link label default.");
	assert(resolvedLink.warnings.length > 0, "Expected link conversion warning.");
	console.log("resolve_field_value fixture: ok");

	const scaffoldedBlock = structured(
		await client.callTool({
			name: "scaffold_block",
			arguments: {
				name: "pricing-table",
				fields: [
					{ name: "headline", type: "text" },
					{ name: "image", type: "image" },
					{ name: "cta", type: "link" },
					{
						name: "features",
						type: "repeater",
						subfields: [
							{ name: "title", type: "text" },
							{ name: "description", type: "text" }
						]
					}
				]
			}
		})
	);
	const scaffoldedBlockFiles = fileMap(scaffoldedBlock);
	const scaffoldedBlockValidation = structured(
		await client.callTool({
			name: "validate_block",
			arguments: {
				name: "pricing-table",
				component_svelte: scaffoldedBlockFiles.get("blocks/pricing-table/component.svelte"),
				config_yaml: scaffoldedBlockFiles.get("blocks/pricing-table/config.yaml"),
				fields_yaml: scaffoldedBlockFiles.get("blocks/pricing-table/fields.yaml"),
				content_yaml: scaffoldedBlockFiles.get("blocks/pricing-table/content.yaml")
			}
		})
	);
	assert(scaffoldedBlockValidation.ok, `Expected scaffolded block to validate: ${JSON.stringify(scaffoldedBlockValidation.errors)}`);
	console.log("scaffold_block fixture: ok");

	const scaffoldedPageType = structured(
		await client.callTool({
			name: "scaffold_page_type",
			arguments: {
				name: "static",
				allowed_blocks: []
			}
		})
	);
	const scaffoldedPageTypeFiles = fileMap(scaffoldedPageType);
	const staticConfig = scaffoldedPageTypeFiles.get("page-types/static/config.yaml");
	assert(staticConfig.includes("static page type"), "Expected static page type comment.");
	const staticConfigErrors = validateJsonSchema(
		"page-type-config",
		loadYaml(staticConfig),
		"page-types/static/config.yaml"
	);
	assert(staticConfigErrors.length === 0, `Expected scaffolded page type config to validate: ${JSON.stringify(staticConfigErrors)}`);
	console.log("scaffold_page_type fixture: ok");
} finally {
	await client.close();
}
