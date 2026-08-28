import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

// Write a block's files under <root>/blocks/<name>/. Any of the four file
// contents may be omitted to simulate a missing file on disk.
function writeBlock(root, name, files) {
	const blockRoot = join(root, "blocks", name);
	mkdirSync(blockRoot, { recursive: true });
	for (const [file, contents] of Object.entries(files)) {
		if (contents === undefined) continue;
		writeFileSync(join(blockRoot, file), contents);
	}
	return blockRoot;
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
		"scaffold_page_type",
		"get_dev_status"
	]) {
		assert(toolNames.has(tool), `Expected ${tool} in tool list.`);
	}
	console.log(`tool list: ${[...toolNames].sort().join(", ")}`);

	const docsList = structured(await client.callTool({ name: "list_docs", arguments: {} }));
	assert(docsList.sections.length >= 6, "Expected docs sections from list_docs.");
	const blocksDocs = structured(await client.callTool({ name: "get_docs", arguments: { section: "blocks" } }));
	assert(blocksDocs.markdown.includes("# Blocks"), "Expected blocks docs markdown.");
	console.log("docs tools: ok");

	const goodBlock = structured(
		await client.callTool({ name: "validate_block", arguments: { site_path: siteRoot, name: "hero" } })
	);
	assert(goodBlock.ok, `Expected hero block to validate: ${JSON.stringify(goodBlock.errors)}`);
	console.log("validate_block good fixture: ok");

	const goodPage = structured(
		await client.callTool({
			name: "validate_page",
			arguments: { site_path: siteRoot, page_path: "pages/index.yaml" }
		})
	);
	assert(goodPage.ok, `Expected index page to validate: ${JSON.stringify(goodPage.errors)}`);
	console.log("validate_page good fixture: ok");

	const goodSite = structured(
		await client.callTool({ name: "validate_site", arguments: { site_path: siteRoot } })
	);
	assert(goodSite.ok, `Expected site to validate: ${JSON.stringify(goodSite.errors)}`);
	console.log("validate_site good fixture: ok");

	// validate_block reads from disk, so the negative fixtures must exist on
	// disk. Build them under a throwaway site dir and clean it up at the end.
	const scratchSite = mkdtempSync(join(tmpdir(), "primo-smoke-"));
	try {
		writeBlock(scratchSite, "broken", {
			"config.yaml": `name: Broken
`,
			"fields.yaml": `- name: headline
  type: text
- name: cta
  type: link
- name: target
  type: page-field
  config: {}
- name: mystery
  type: unknown-type
`,
			"content.yaml": `cta: /book
extra: not defined
`,
			"component.svelte": `<script>
  let { headline, missing_prop } = $props()
  $: doubled = headline + headline
</script>

<button on:click={() => {}} data-key="unknown">{headline}</button>
`
		});
		const brokenBlock = structured(
			await client.callTool({ name: "validate_block", arguments: { site_path: scratchSite, name: "broken" } })
		);
		assert(!brokenBlock.ok, "Expected broken block to fail.");
		assert(hasMessage(brokenBlock, "unknown-type"), "Expected unknown field type error.");
		assert(hasMessage(brokenBlock, "config.field"), "Expected page-field config.field error.");
		assert(hasMessage(brokenBlock, "$props() destructures"), "Expected missing $props field error.");
		assert(hasMessage(brokenBlock, "link object"), "Expected bad link shape error.");
		assert(hasMessage(brokenBlock, "on:click"), "Expected Svelte on:click error.");
		// The mismatch that silently drops content: a content.yaml key with no
		// matching field. This is the exact failure inline validation missed.
		assert(hasMessage(brokenBlock, `"extra"`), "Expected undefined content key error.");
		console.log("validate_block broken fixture: ok");

		// A block whose fields.yaml/config.yaml were never written to disk — the
		// real-world footgun: inline validation returned ok, primo dev then found
		// no matching fields and silently dropped the block content.
		writeBlock(scratchSite, "missing-files", {
			"component.svelte": `<script>
  let { headline } = $props()
</script>
<h1 data-key="headline">{headline}</h1>
`,
			"content.yaml": `headline: Hi
`
			// config.yaml and fields.yaml deliberately omitted.
		});
		const missingFiles = structured(
			await client.callTool({ name: "validate_block", arguments: { site_path: scratchSite, name: "missing-files" } })
		);
		assert(!missingFiles.ok, "Expected block with missing files to fail.");
		assert(hasMessage(missingFiles, "fields.yaml does not exist"), "Expected missing fields.yaml error.");
		assert(hasMessage(missingFiles, "config.yaml does not exist"), "Expected missing config.yaml error.");
		console.log("validate_block missing-files fixture: ok");

		// An empty required file (present but zero-length) must also fail — an
		// empty fields.yaml imports as a block with no fields.
		writeBlock(scratchSite, "empty-fields", {
			"component.svelte": `<h1>Static</h1>
`,
			"config.yaml": `name: Empty Fields
`,
			"fields.yaml": "",
			"content.yaml": "{}\n"
		});
		const emptyFields = structured(
			await client.callTool({ name: "validate_block", arguments: { site_path: scratchSite, name: "empty-fields" } })
		);
		assert(!emptyFields.ok, "Expected block with empty fields.yaml to fail.");
		assert(hasMessage(emptyFields, "fields.yaml is empty"), "Expected empty fields.yaml error.");
		console.log("validate_block empty-fields fixture: ok");

		// scaffold_block returns file contents; write them to disk and confirm a
		// freshly scaffolded block passes on-disk validation.
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
		writeBlock(scratchSite, "pricing-table", {
			"component.svelte": scaffoldedBlockFiles.get("blocks/pricing-table/component.svelte"),
			"config.yaml": scaffoldedBlockFiles.get("blocks/pricing-table/config.yaml"),
			"fields.yaml": scaffoldedBlockFiles.get("blocks/pricing-table/fields.yaml"),
			"content.yaml": scaffoldedBlockFiles.get("blocks/pricing-table/content.yaml")
		});
		const scaffoldedBlockValidation = structured(
			await client.callTool({ name: "validate_block", arguments: { site_path: scratchSite, name: "pricing-table" } })
		);
		assert(scaffoldedBlockValidation.ok, `Expected scaffolded block to validate: ${JSON.stringify(scaffoldedBlockValidation.errors)}`);
		console.log("scaffold_block fixture: ok");

		// validate_page reads the page, its page type, and blocks/ from disk.
		// The page points at the page-types/blog-post/ folder (which exists), but
		// that config declares a different name — a real folder-vs-name drift that
		// trips the page_type mismatch check. It also has an undefined page field,
		// a bad link, and a section referencing a block with no folder on disk.
		mkdirSync(join(scratchSite, "pages"), { recursive: true });
		mkdirSync(join(scratchSite, "page-types", "blog-post"), { recursive: true });
		writeFileSync(
			join(scratchSite, "page-types", "blog-post", "config.yaml"),
			`name: Renamed Type
allowed_blocks:
  - existing
`
		);
		writeFileSync(
			join(scratchSite, "page-types", "blog-post", "fields.yaml"),
			`- name: seo_title
  type: text
`
		);
		// A real block on disk so the "good" section reference resolves and only
		// the deliberately-missing block trips the missing-block error.
		writeBlock(scratchSite, "existing", {
			"component.svelte": `<a data-key="cta" href={cta.url}>{cta.label}</a>
`,
			"config.yaml": `name: Existing
`,
			"fields.yaml": `- name: cta
  type: link
`,
			"content.yaml": "{}\n"
		});
		writeFileSync(
			join(scratchSite, "pages", "broken.yaml"),
			`name: Broken
page_type: blog-post
fields:
  unknown: nope
sections:
  - block: missing
    content: {}
  - block: existing
    content:
      cta: /bad-link
      extra: not defined
`
		);
		const brokenPage = structured(
			await client.callTool({
				name: "validate_page",
				arguments: { site_path: scratchSite, page_path: "pages/broken.yaml" }
			})
		);
		assert(!brokenPage.ok, "Expected broken page to fail.");
		assert(hasMessage(brokenPage, "page_type"), "Expected page_type mismatch error.");
		assert(hasMessage(brokenPage, `"unknown"`), "Expected unknown page field error.");
		assert(hasMessage(brokenPage, "no usable blocks/missing/fields.yaml"), "Expected missing block error.");
		assert(hasMessage(brokenPage, "link object"), "Expected section bad link shape error.");
		assert(hasMessage(brokenPage, `"extra"`), "Expected undefined section content key error.");
		console.log("validate_page broken fixture: ok");

		// A page whose page_type points at a page-type folder that does not exist
		// on disk — inline validation could not catch this.
		writeFileSync(
			join(scratchSite, "pages", "orphan.yaml"),
			`name: Orphan
page_type: nonexistent
sections: []
`
		);
		const orphanPage = structured(
			await client.callTool({
				name: "validate_page",
				arguments: { site_path: scratchSite, page_path: "pages/orphan.yaml" }
			})
		);
		assert(!orphanPage.ok, "Expected page with missing page type to fail.");
		assert(hasMessage(orphanPage, "page-types/nonexistent/config.yaml does not exist"), "Expected missing page-type error.");
		console.log("validate_page missing-page-type fixture: ok");

		// A malformed page must report the YAML parse error, not a misleading
		// "page-type missing" error. The page can't be parsed, so its page_type is
		// unknown and the resolver falls back to page-types/default/ (absent in
		// this scratch site) — the parse error must still win.
		writeFileSync(
			join(scratchSite, "pages", "malformed.yaml"),
			`name: Broken
sections:
  - block: hero
   content: {}
`
		);
		const malformedPage = structured(
			await client.callTool({
				name: "validate_page",
				arguments: { site_path: scratchSite, page_path: "pages/malformed.yaml" }
			})
		);
		assert(!malformedPage.ok, "Expected malformed page to fail.");
		assert(hasMessage(malformedPage, "Could not parse"), "Expected YAML parse error, not a page-type error.");
		assert(!hasMessage(malformedPage, "config.yaml does not exist"), "Parse error must win over the page-type read error.");
		console.log("validate_page malformed fixture: ok");

		// validate_site reads site/head.svelte. A file that wraps its children in
		// <svelte:head> breaks the import contract.
		mkdirSync(join(scratchSite, "site"), { recursive: true });
		writeFileSync(
			join(scratchSite, "site", "head.svelte"),
			`<svelte:head>
  <title>Nested</title>
</svelte:head>
`
		);
		const brokenSite = structured(
			await client.callTool({ name: "validate_site", arguments: { site_path: scratchSite } })
		);
		assert(!brokenSite.ok, "Expected site with nested <svelte:head> to fail.");
		console.log("validate_site broken fixture: ok");
	} finally {
		rmSync(scratchSite, { recursive: true, force: true });
	}

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

	// get_dev_status reads .primo/sync_status.json from a site dir. Exercise it
	// against a throwaway dir for the three cases the CLI writes: no file
	// (dev not running), a clean import, and an import that dropped fields.
	const devStatusDir = mkdtempSync(join(tmpdir(), "primo-devstatus-"));
	try {
		const missing = structured(
			await client.callTool({ name: "get_dev_status", arguments: { site_path: devStatusDir } })
		);
		assert(missing.running === false, "Expected running=false when no sync_status.json exists.");
		assert(missing.ok === false, "Expected ok=false when dev has not run.");
		assert(missing.warning_count === 0, "Expected warning_count=0 when dev has not run.");

		mkdirSync(join(devStatusDir, ".primo"), { recursive: true });
		writeFileSync(
			join(devStatusDir, ".primo", "sync_status.json"),
			JSON.stringify({ ok: true, last_import_at: "2026-01-01T00:00:00.000Z", port: 3000, url: "http://127.0.0.1:3000" })
		);
		const clean = structured(
			await client.callTool({ name: "get_dev_status", arguments: { site_path: devStatusDir } })
		);
		assert(clean.running === true && clean.ok === true, "Expected running+ok on a clean import.");
		assert(clean.warning_count === 0 && clean.warning_details.length === 0, "Expected no warnings on a clean import.");
		assert(clean.port === 3000 && clean.url === "http://127.0.0.1:3000", "Expected port/url to be surfaced.");

		writeFileSync(
			join(devStatusDir, ".primo", "sync_status.json"),
			JSON.stringify({
				ok: true,
				warnings: 1,
				warned_at: "2026-01-01T00:00:00.000Z",
				warning_details: [
					{ kind: "orphaned_field", file: "pages/index.yaml", path: "content.hero.title", field: "title", block: "hero", message: "no matching field" }
				],
				last_import_at: "2026-01-01T00:00:00.000Z"
			})
		);
		const dropped = structured(
			await client.callTool({ name: "get_dev_status", arguments: { site_path: devStatusDir } })
		);
		assert(dropped.ok === true, "Expected ok=true when import succeeded with warnings.");
		assert(dropped.warning_count === 1, "Expected warning_count=1.");
		assert(dropped.warning_details.length === 1, "Expected the dropped-field detail to be surfaced.");
		assert(dropped.warning_details[0].field === "title", "Expected the dropped field name in details.");

		writeFileSync(
			join(devStatusDir, ".primo", "sync_status.json"),
			JSON.stringify({ ok: false, error: "duplicate _id", failed_at: "2026-01-01T00:00:00.000Z" })
		);
		const failed = structured(
			await client.callTool({ name: "get_dev_status", arguments: { site_path: devStatusDir } })
		);
		assert(failed.running === true && failed.ok === false, "Expected running=true, ok=false on a failed import.");
		assert(failed.error === "duplicate _id", "Expected the import error to be surfaced.");

		// Older/count-only writer: a count with no warning_details must still
		// report the count and an empty details array (compat requirement).
		writeFileSync(
			join(devStatusDir, ".primo", "sync_status.json"),
			JSON.stringify({ ok: true, warnings: 1 })
		);
		const countOnly = structured(
			await client.callTool({ name: "get_dev_status", arguments: { site_path: devStatusDir } })
		);
		assert(countOnly.ok === true && countOnly.warning_count === 1, "Expected count-only status to preserve the count.");
		assert(countOnly.warning_details.length === 0, "Expected count-only status to have empty details.");

		// A partial record with no definitive outcome must never infer success.
		writeFileSync(
			join(devStatusDir, ".primo", "sync_status.json"),
			JSON.stringify({ warnings: 0 })
		);
		const incomplete = structured(
			await client.callTool({ name: "get_dev_status", arguments: { site_path: devStatusDir } })
		);
		assert(incomplete.running === true && incomplete.ok === false, "Expected incomplete status (no ok) to report ok=false.");

		// Malformed JSON is treated as no status at all, not an error.
		writeFileSync(join(devStatusDir, ".primo", "sync_status.json"), "{ not json");
		const malformed = structured(
			await client.callTool({ name: "get_dev_status", arguments: { site_path: devStatusDir } })
		);
		assert(malformed.running === false && malformed.ok === false, "Expected malformed status to report not-running.");
		console.log("get_dev_status fixture: ok");
	} finally {
		rmSync(devStatusDir, { recursive: true, force: true });
	}
} finally {
	await client.close();
}
