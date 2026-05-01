import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as esbuild from "esbuild";
import MarkdownIt from "markdown-it";
import postcss from "postcss";
import postcssNested from "postcss-nested";
import * as svelteCompiler from "svelte/compiler";
import { render } from "svelte/server";

const { compile } = svelteCompiler;
const require = createRequire(import.meta.url);
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const PRIMO_BASELINE_CSS = `
  :root {
    font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    line-height: 1.5;
    text-size-adjust: 100%;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }

  html,
  body {
    margin: 0;
    min-height: 100%;
  }

  body {
    overflow-x: hidden;
  }

  h1,
  h2,
  h3,
  h4,
  h5,
  h6,
  p,
  figure,
  blockquote,
  dl,
  dd {
    margin: 0;
  }

  ul,
  ol {
    margin: 0;
    padding: 0;
  }

  img,
  picture,
  video,
  canvas,
  svg {
    display: block;
    max-width: 100%;
  }

  input,
  button,
  textarea,
  select {
    font: inherit;
  }

  a {
    color: inherit;
  }
`;

type RecordBase = {
	id: string;
	created?: string;
};

export type SiteRecord = RecordBase & {
	name: string;
	host?: string;
	head?: string;
	foot?: string;
};

type PageRecord = RecordBase & {
	name: string;
	slug: string;
	parent: string;
	page_type: string;
	site: string;
	index?: number;
};

type PageTypeRecord = RecordBase & {
	name: string;
	head?: string;
	foot?: string;
	site: string;
};

type SymbolRecord = RecordBase & {
	name?: string;
	html: string;
	css: string;
	js: string;
	site: string;
};

type FieldRecord = RecordBase & {
	key?: string;
	label?: string;
	type: string;
	config?: Record<string, unknown> | null;
	parent?: string;
	index?: number;
	site?: string;
	symbol?: string;
	page_type?: string;
};

type EntryRecord = RecordBase & {
	locale?: string;
	value: unknown;
	field: string;
	parent?: string;
	index?: number;
	page?: string;
	section?: string;
};

type PageSectionRecord = RecordBase & {
	page: string;
	symbol: string;
	index?: number;
};

type PageTypeSectionRecord = RecordBase & {
	page_type: string;
	symbol: string;
	index?: number;
	zone: "header" | "body" | "footer";
};

type SectionRecord = PageSectionRecord | PageTypeSectionRecord;

type UploadRecord = RecordBase & {
	file: string;
	site: string;
};

type SiteGraph = {
	site: SiteRecord;
	pages: PageRecord[];
	pageTypes: PageTypeRecord[];
	symbols: SymbolRecord[];
	uploads: UploadRecord[];
	siteFields: FieldRecord[];
	symbolFields: FieldRecord[];
	pageTypeFields: FieldRecord[];
	siteEntries: EntryRecord[];
	symbolEntries: EntryRecord[];
	pageEntries: EntryRecord[];
	pageSections: PageSectionRecord[];
	pageSectionEntries: EntryRecord[];
	pageTypeSections: PageTypeSectionRecord[];
	pageTypeSectionEntries: EntryRecord[];
	pageTypeEntries: EntryRecord[];
};

type ComponentInput = {
	html: string;
	js: string;
	css: string;
	data: Record<string, unknown>;
	wrapper_start?: string;
	wrapper_end?: string;
};

type CompileHead = {
	code: string;
	data: Record<string, unknown>;
};

type PublishArtifactSummary = {
	pageCount: number;
	symbolCount: number;
};

const cssCache = new Map<string, string>();
const markdown = new MarkdownIt({
	html: true,
	linkify: true,
	typographer: true
});

export async function compileAndUploadPublishArtifacts(
	apiUrl: string,
	token: string,
	site: SiteRecord
): Promise<PublishArtifactSummary> {
	const graph = await fetchSiteGraph(apiUrl, token, site);
	const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "primo-mcp-publish-"));

	try {
		const symbolArtifacts = await compileSymbols(graph, tempDir);
		await Promise.all(
			symbolArtifacts.map((artifact) =>
				uploadTextFileField(apiUrl, token, "site_symbols", artifact.symbolId, "compiled_js", artifact.js, "symbol.js", "text/javascript")
			)
		);

		const pageArtifacts = await compilePages(graph, tempDir);
		await Promise.all(
			pageArtifacts.map((artifact) =>
				uploadTextFileField(apiUrl, token, "pages", artifact.pageId, "compiled_html", artifact.html, "index.html", "text/html")
			)
		);

		const homepage = pageArtifacts.find((artifact) => artifact.isHomepage);
		if (homepage) {
			await uploadTextFileField(apiUrl, token, "sites", site.id, "preview", homepage.html, "index.html", "text/html");
		}

		return {
			pageCount: pageArtifacts.length,
			symbolCount: symbolArtifacts.length
		};
	} finally {
		await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
	}
}

async function fetchSiteGraph(apiUrl: string, token: string, site: SiteRecord): Promise<SiteGraph> {
	const [
		pages,
		pageTypes,
		symbols,
		uploads,
		siteFields,
		symbolFields,
		pageTypeFields,
		siteEntries,
		symbolEntries,
		pageEntries,
		pageSections,
		pageSectionEntries,
		pageTypeSections,
		pageTypeSectionEntries,
		pageTypeEntries
	] = await Promise.all([
		fetchAll<PageRecord>(apiUrl, token, "pages", `site="${site.id}"`, "+index"),
		fetchAll<PageTypeRecord>(apiUrl, token, "page_types", `site="${site.id}"`, "+created"),
		fetchAll<SymbolRecord>(apiUrl, token, "site_symbols", `site="${site.id}"`),
		fetchAll<UploadRecord>(apiUrl, token, "site_uploads", `site="${site.id}"`),
		fetchAll<FieldRecord>(apiUrl, token, "site_fields", `site="${site.id}"`, "+index"),
		fetchAll<FieldRecord>(apiUrl, token, "site_symbol_fields", `symbol.site="${site.id}"`, "+index"),
		fetchAll<FieldRecord>(apiUrl, token, "page_type_fields", `page_type.site="${site.id}"`, "+index"),
		fetchAll<EntryRecord>(apiUrl, token, "site_entries", `field.site="${site.id}"`, "+index"),
		fetchAll<EntryRecord>(apiUrl, token, "site_symbol_entries", `field.symbol.site="${site.id}"`, "+index"),
		fetchAll<EntryRecord>(apiUrl, token, "page_entries", `page.site="${site.id}"`, "+index"),
		fetchAll<PageSectionRecord>(apiUrl, token, "page_sections", `page.site="${site.id}"`, "+index"),
		fetchAll<EntryRecord>(apiUrl, token, "page_section_entries", `section.page.site="${site.id}"`, "+index"),
		fetchAll<PageTypeSectionRecord>(apiUrl, token, "page_type_sections", `page_type.site="${site.id}"`, "+index"),
		fetchAll<EntryRecord>(apiUrl, token, "page_type_section_entries", `section.page_type.site="${site.id}"`, "+index"),
		fetchAll<EntryRecord>(apiUrl, token, "page_type_entries", `field.page_type.site="${site.id}"`, "+index")
	]);

	return {
		site,
		pages,
		pageTypes,
		symbols,
		uploads,
		siteFields,
		symbolFields,
		pageTypeFields,
		siteEntries,
		symbolEntries,
		pageEntries,
		pageSections,
		pageSectionEntries,
		pageTypeSections,
		pageTypeSectionEntries,
		pageTypeEntries
	};
}

async function fetchAll<T>(
	apiUrl: string,
	token: string,
	collection: string,
	filter: string,
	sort = ""
): Promise<T[]> {
	const perPage = 500;
	const items: T[] = [];

	for (let page = 1; ; page++) {
		const params = new URLSearchParams({
			filter,
			perPage: String(perPage),
			page: String(page)
		});
		if (sort) params.set("sort", sort);

		const response = await fetch(`${apiUrl}/api/collections/${collection}/records?${params.toString()}`, {
			headers: {
				Authorization: token
			}
		});
		if (!response.ok) {
			const body = await response.text().catch(() => "");
			throw new Error(`Failed to fetch ${collection} (HTTP ${response.status}): ${body || "no body"}`);
		}

		const result = (await response.json()) as { items?: T[]; totalPages?: number };
		items.push(...(result.items ?? []));
		if (page >= (result.totalPages ?? 1)) break;
	}

	return items;
}

async function compileSymbols(graph: SiteGraph, tempDir: string): Promise<Array<{ symbolId: string; js: string }>> {
	const artifacts: Array<{ symbolId: string; js: string }> = [];

	for (const symbol of graph.symbols) {
		if (!symbol.js) continue;

		const processedCss = await processCss(symbol.css || "");
		const symbolFields = graph.symbolFields.filter((field) => field.symbol === symbol.id);
		const symbolContent = contentFor(graph, { kind: "symbol", entity: symbol })["en"] ?? {};
		const genericData = Object.fromEntries(
			symbolFields
				.map((field) => field.key)
				.filter((key): key is string => !!key)
				.map((key) => [key, symbolContent[key] ?? ""])
		);

		const js = await compileClientBundle(
			{
				html: symbol.html,
				js: symbol.js,
				css: processedCss,
				data: genericData
			},
			tempDir
		);

		artifacts.push({ symbolId: symbol.id, js });
	}

	return artifacts;
}

async function compilePages(graph: SiteGraph, tempDir: string): Promise<Array<{ pageId: string; html: string; isHomepage: boolean }>> {
	const artifacts: Array<{ pageId: string; html: string; isHomepage: boolean }> = [];

	for (const page of graph.pages) {
		const pageType = graph.pageTypes.find((candidate) => candidate.id === page.page_type);
		if (!pageType) {
			throw new Error(`Page "${page.name || page.id}" references missing page type ${page.page_type}.`);
		}

		const headerSections = graph.pageTypeSections
			.filter((section) => section.page_type === pageType.id && section.zone === "header")
			.sort(sortByIndex);
		const bodySections = graph.pageSections
			.filter((section) => section.page === page.id)
			.sort(sortByIndex);
		const footerSections = graph.pageTypeSections
			.filter((section) => section.page_type === pageType.id && section.zone === "footer")
			.sort(sortByIndex);
		const sections = deduplicateById([...headerSections, ...bodySections, ...footerSections]);

		const siteData = {
			...(contentFor(graph, { kind: "site", entity: graph.site })["en"] ?? {}),
			...(contentFor(graph, { kind: "page", entity: page })["en"] ?? {})
		};

		const head = {
			code: `<style data-primo-baseline>${PRIMO_BASELINE_CSS}</style>${graph.site.head ?? ""}${pageType.head ?? ""}`,
			data: siteData
		};
		const headWithoutCode = {
			code: "",
			data: siteData
		};

		const headerResult = headerSections.length > 0
			? await compileSectionGroup(graph, headerSections, page, head, tempDir)
			: { body: "", head: "" };
		const bodyResult = bodySections.length > 0
			? await compileSectionGroup(graph, bodySections, page, headerSections.length > 0 ? headWithoutCode : head, tempDir)
			: { body: "", head: "" };
		const footerResult = footerSections.length > 0
			? await compileSectionGroup(
					graph,
					footerSections,
					page,
					headerSections.length > 0 || bodySections.length > 0 ? headWithoutCode : head,
					tempDir
				)
			: { body: "", head: "" };

		const bodyContent =
			(headerResult.body ? `<header>${headerResult.body}</header>` : "") +
			`<main>${bodyResult.body || ""}</main>` +
			(footerResult.body ? `<footer>${footerResult.body}</footer>` : "");

		const symbolsWithJs = deduplicateById(
			sections
				.map((section) => graph.symbols.find((symbol) => symbol.id === section.symbol))
				.filter((symbol): symbol is SymbolRecord => !!symbol && !!symbol.js)
		);
		const hydrationScript = symbolsWithJs.length > 0
			? `<script type="module">${buildHydrationScript(graph, sections, page, symbolsWithJs)}</script>`
			: "";

		const html =
			`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="generator" content="PalaCMS" />` +
			(headerResult.head || "") +
			(bodyResult.head || "") +
			(footerResult.head || "") +
			`</head><body id="page">` +
			bodyContent +
			hydrationScript +
			(graph.site.foot ?? "") +
			`</body></html>`;

		artifacts.push({
			pageId: page.id,
			html,
			isHomepage: !page.parent
		});
	}

	return artifacts;
}

async function compileSectionGroup(
	graph: SiteGraph,
	sections: SectionRecord[],
	page: PageRecord,
	head: CompileHead,
	tempDir: string
): Promise<{ body: string; head: string }> {
	const components: ComponentInput[] = [];

	for (const section of sections) {
		const symbol = graph.symbols.find((candidate) => candidate.id === section.symbol);
		if (!symbol) continue;

		const data = contentFor(graph, sectionKind(section), { page })["en"] ?? {};
		components.push({
			html: symbol.html,
			js: symbol.js,
			css: await processCss(symbol.css || ""),
			data,
			wrapper_start: `<div data-section="${escapeAttribute(section.id)}" id="section-${escapeAttribute(section.id)}" data-symbol="${escapeAttribute(symbol.id)}">`,
			wrapper_end: "</div>"
		});
	}

	if (components.length === 0) return { body: "", head: "" };

	return compileServerBundle(components, head, tempDir);
}

function buildHydrationScript(
	graph: SiteGraph,
	sections: SectionRecord[],
	page: PageRecord,
	symbols: SymbolRecord[]
): string {
	return symbols
		.map((symbol) => {
			const sectionHydration = sections
				.filter((section) => section.symbol === symbol.id)
				.map((section) => {
					const data = contentFor(graph, sectionKind(section), { page })["en"] ?? {};
					return `hydrate(App, { target: document.querySelector('#section-${cssStringEscape(section.id)}'), props: ${safeJson(data)} });`;
				})
				.join("");

			return `import('/_symbols/${jsStringEscape(symbol.id)}.js').then(({ default: App, hydrate }) => {${sectionHydration}}).catch(e => console.error(e));`;
		})
		.join("");
}

async function compileClientBundle(component: ComponentInput, tempDir: string): Promise<string> {
	return bundleVirtualProject({
		files: new Map([
			["./entry.js", `export { default } from './App.svelte';\nexport { hydrate } from 'svelte';`],
			["./App.svelte", componentSource(component)]
		]),
		svelteOptions: {
			generate: "client",
			css: "external",
			runes: true
		},
		platform: "browser",
		tempDir
	});
}

async function compileServerBundle(
	components: ComponentInput[],
	head: CompileHead,
	tempDir: string
): Promise<{ body: string; head: string }> {
	const files = new Map<string, string>();
	files.set("./entry.js", `export { default } from './App.svelte';`);
	files.set("./App.svelte", appWrapperSource(components, head));
	components.forEach((component, index) => {
		files.set(`./Component_${index}.svelte`, componentSource(component));
	});

	const code = await bundleVirtualProject({
		files,
		svelteOptions: {
			generate: "server",
			css: "injected",
			runes: true
		},
		platform: "node",
		tempDir
	});

	const bundlePath = path.join(tempDir, `server-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`);
	await fs.writeFile(bundlePath, code);
	const module = (await import(`${pathToFileURL(bundlePath).href}?t=${Date.now()}`)) as { default: unknown };

	const props: Record<string, unknown> = {};
	components.forEach((component, index) => {
		if (Object.keys(component.data).length > 0) {
			props[`component_${index}_props`] = component.data;
		}
	});
	props.head_props = head.data;

	const rendered = (render as (component: unknown, options: { props: Record<string, unknown> }) => { body: string; head: string })(
		module.default,
		{ props }
	);
	return {
		body: rendered.body,
		head: rendered.head
	};
}

async function bundleVirtualProject({
	files,
	svelteOptions,
	platform,
	tempDir
}: {
	files: Map<string, string>;
	svelteOptions: Record<string, unknown>;
	platform: "browser" | "node";
	tempDir: string;
}): Promise<string> {
	const result = await esbuild.build({
		entryPoints: ["./entry.js"],
		bundle: true,
		format: "esm",
		platform,
		absWorkingDir: PACKAGE_ROOT,
		write: false,
		outdir: tempDir,
		logLevel: "silent",
		plugins: [
			{
				name: "primo-mcp-virtual-svelte",
				setup(build) {
					build.onResolve({ filter: /.*/ }, (args) => {
						const resolved = resolveVirtualPath(args.path, args.importer);
						if (files.has(resolved)) {
							return { path: resolved, namespace: "primo-virtual" };
						}
						if (args.namespace === "primo-virtual" && !args.path.startsWith(".")) {
							return { path: resolveBareImport(args.path, platform) };
						}
						return undefined;
					});

					build.onLoad({ filter: /.*/, namespace: "primo-virtual" }, (args) => {
						const source = files.get(args.path);
						if (source === undefined) return undefined;

						if (args.path.endsWith(".svelte")) {
							// Don't pass `filename` — Svelte's default cssHash falls back to hashing the CSS
							// when filename is unknown, which gives each component a unique scoped class.
							// Passing the virtual filename made all `./Component_N.svelte` files share a hash
							// across the header/body/footer bundles, producing duplicate `<style id>` blocks
							// that one zone's hydration would clobber, leaving the others unstyled.
							const compiled = compile(source, {
								...svelteOptions
							});
							return {
								contents: compiled.js.code,
								loader: "js",
								resolveDir: PACKAGE_ROOT
							};
						}

						return {
							contents: source,
							loader: "js",
							resolveDir: PACKAGE_ROOT
						};
					});
				}
			}
		]
	});

	const output = result.outputFiles?.[0]?.text;
	if (!output) {
		throw new Error("Svelte bundle did not produce JavaScript output.");
	}
	return output;
}

function componentSource(component: ComponentInput): string {
	const fieldKeys = Object.keys(component.data).filter(Boolean);
	const userDeclaresProps = component.js && (component.js.includes("$props()") || component.js.includes("$props("));

	return `${component.html}
<script>
${userDeclaresProps ? "" : `let { ${fieldKeys.join(", ")} } = $props();`}
${component.js || ""}
</script>
${component.css ? `<style>${component.css}</style>` : ""}`;
}

function appWrapperSource(components: ComponentInput[], head: CompileHead): string {
	const headKeys = Object.keys(head.data).filter(Boolean);
	const imports = components.map((_, index) => `import Component_${index} from './Component_${index}.svelte';`).join("\n");
	const propDeclarations = components.map((_, index) => `let { component_${index}_props = {} } = props;`).join("\n");
	const headDeclarations = headKeys.map((key) => `let ${key} = head_props['${key}'];`).join("\n");
	const renders = components
		.map((component, index) => `${component.wrapper_start ?? ""}<Component_${index} {...component_${index}_props} />${component.wrapper_end ?? ""}`)
		.join("\n");

	return `<svelte:head>
${head.code}
</svelte:head>
<script>
let props = $props();
${imports}
${propDeclarations}
let { head_props = {} } = props;
${headDeclarations}
</script>
${renders}`;
}

function resolveVirtualPath(importPath: string, importer: string): string {
	if (!importPath.startsWith(".")) return importPath;
	const base = importer ? path.posix.dirname(importer) : ".";
	const normalized = path.posix.normalize(path.posix.join(base, importPath));
	return normalized.startsWith(".") ? normalized : `./${normalized}`;
}

function resolveBareImport(importPath: string, platform: "browser" | "node"): string {
	if (platform === "browser" && importPath === "svelte") {
		return path.join(PACKAGE_ROOT, "node_modules/svelte/src/index-client.js");
	}
	return require.resolve(importPath);
}

function contentFor(
	graph: SiteGraph,
	target:
		| { kind: "site"; entity: SiteRecord }
		| { kind: "symbol"; entity: SymbolRecord }
		| { kind: "page"; entity: PageRecord }
		| { kind: "page_section"; entity: PageSectionRecord }
		| { kind: "page_type_section"; entity: PageTypeSectionRecord }
		| { kind: "page_type"; entity: PageTypeRecord },
	options: { page?: PageRecord } = {}
): Record<string, Record<string, unknown>> {
	const fields = fieldsFor(graph, target);
	const entries = entriesFor(graph, target);
	return buildContent(graph, target, fields, entries, options);
}

function buildContent(
	graph: SiteGraph,
	target:
		| { kind: "site"; entity: SiteRecord }
		| { kind: "symbol"; entity: SymbolRecord }
		| { kind: "page"; entity: PageRecord }
		| { kind: "page_section"; entity: PageSectionRecord }
		| { kind: "page_type_section"; entity: PageTypeSectionRecord }
		| { kind: "page_type"; entity: PageTypeRecord },
	fields: FieldRecord[],
	entries: EntryRecord[],
	options: { page?: PageRecord; parentField?: FieldRecord; parentEntry?: EntryRecord } = {}
): Record<string, Record<string, unknown>> {
	const content: Record<string, Record<string, unknown>> = {};
	const filteredFields = fields
		.filter((field) => (options.parentField ? field.parent === options.parentField.id : !field.parent))
		.filter((field) => !!field.key)
		.sort(sortByIndex);

	for (const field of filteredFields) {
		if (!field.key) continue;
		const fieldEntries = resolveEntries(entries, field, target, options.parentEntry);

		if (field.type === "page-field") {
			const sourceFieldId = stringFromConfig(field, "field");
			const sourceField = sourceFieldId ? graph.pageTypeFields.find((candidate) => candidate.id === sourceFieldId) : undefined;
			if (!sourceField?.key) continue;

			const sourcePage = options.page ?? (target.kind === "page_section" ? graph.pages.find((page) => page.id === target.entity.page) : undefined);
			if (!sourcePage) continue;

			const sourceContent = contentFor(graph, { kind: "page", entity: sourcePage });
			if (!content.en) content.en = {};
			content.en[field.key] = sourceContent.en?.[sourceField.key] ?? getEmptyValue(sourceField);
			continue;
		}

		if (field.type === "site-field") {
			const sourceFieldId = stringFromConfig(field, "field");
			const sourceField = sourceFieldId ? graph.siteFields.find((candidate) => candidate.id === sourceFieldId) : undefined;
			if (!sourceField?.key) continue;

			const sourceContent = contentFor(graph, { kind: "site", entity: graph.site });
			if (!content.en) content.en = {};
			content.en[field.key] = sourceContent.en?.[sourceField.key];
			continue;
		}

		if (field.type === "group") {
			const [entry] = fieldEntries;
			if (!content.en) content.en = {};
			if (!entry) {
				content.en[field.key] = getEmptyValue(field) ?? {};
				continue;
			}

			const nested = buildContent(graph, target, fields, entries, { ...options, parentField: field, parentEntry: entry });
			content.en[field.key] = nested.en ?? {};
			continue;
		}

		if (field.type === "repeater") {
			if (!content.en) content.en = {};
			content.en[field.key] = [];
			for (const entry of fieldEntries) {
				const nested = buildContent(graph, target, fields, entries, { ...options, parentField: field, parentEntry: entry });
				(content.en[field.key] as unknown[]).push(nested[entry.locale || "en"] ?? {});
			}
			continue;
		}

		if (field.type === "markdown") {
			const [entry] = fieldEntries;
			if (!content.en) content.en = {};
			if (!entry) {
				content.en[field.key] = getEmptyValue(field);
				continue;
			}
			const value = normalizeEntryValue(entry.value);
			localeContent(content, entry.locale || "en")[field.key] = typeof value === "string" ? markdown.render(value) : "";
			continue;
		}

		if (field.type === "rich-text") {
			const [entry] = fieldEntries;
			if (!content.en) content.en = {};
			if (!entry) {
				content.en[field.key] = "";
				continue;
			}
			localeContent(content, entry.locale || "en")[field.key] = renderRichTextFallback(normalizeEntryValue(entry.value));
			continue;
		}

		if (field.type === "image") {
			const [entry] = fieldEntries;
			if (!content.en) content.en = {};
			if (!entry) {
				content.en[field.key] = getEmptyValue(field);
				continue;
			}
			const value = normalizeEntryValue(entry.value) as Record<string, unknown>;
			const uploadId = typeof value.upload === "string" ? value.upload : "";
			const upload = uploadId ? graph.uploads.find((candidate) => candidate.id === uploadId) : undefined;
			const url = typeof value.url === "string" && value.url ? value.url : upload ? `/_uploads/${upload.file}` : "";
			localeContent(content, entry.locale || "en")[field.key] = {
				alt: typeof value.alt === "string" ? value.alt : "",
				url
			};
			continue;
		}

		if (field.type === "page") {
			const [entry] = fieldEntries;
			if (!content.en) content.en = {};
			if (!entry) {
				content.en[field.key] = getEmptyValue(field);
				continue;
			}
			const pageId = normalizeEntryValue(entry.value);
			const page = typeof pageId === "string" ? graph.pages.find((candidate) => candidate.id === pageId) : undefined;
			if (!page) continue;
			const pageContent = contentFor(graph, { kind: "page", entity: page });
			localeContent(content, entry.locale || "en")[field.key] = {
				...(pageContent[entry.locale || "en"] ?? {}),
				_meta: pageMeta(graph, page)
			};
			continue;
		}

		if (field.type === "page-list") {
			const pageTypeId = stringFromConfig(field, "page_type");
			if (!pageTypeId) continue;
			const pages = graph.pages.filter((page) => page.page_type === pageTypeId).sort(sortByIndex);
			if (!content.en) content.en = {};
			content.en[field.key] = pages.map((page) => ({
				...(contentFor(graph, { kind: "page", entity: page }).en ?? {}),
				_meta: pageMeta(graph, page)
			}));
			continue;
		}

		if (field.type === "link") {
			const [entry] = fieldEntries;
			if (!content.en) content.en = {};
			if (!entry) {
				content.en[field.key] = getEmptyValue(field);
				continue;
			}
			const value = normalizeEntryValue(entry.value) as Record<string, unknown>;
			const pageId = typeof value.page === "string" ? value.page : "";
			const linkedPage = pageId ? graph.pages.find((page) => page.id === pageId) : undefined;
			const label = typeof value.label === "string" ? value.label : "";
			const url = linkedPage ? buildLivePagePath(graph, linkedPage) : typeof value.url === "string" ? value.url : "";
			localeContent(content, entry.locale || "en")[field.key] = {
				url,
				label,
				text: label
			};
			continue;
		}

		if (fieldEntries.length === 0) {
			if (!content.en) content.en = {};
			content.en[field.key] = getEmptyValue(field);
			continue;
		}

		const [entry] = fieldEntries;
		if (!entry) continue;
		localeContent(content, entry.locale || "en")[field.key] = normalizeEntryValue(entry.value);
	}

	return content;
}

function fieldsFor(
	graph: SiteGraph,
	target:
		| { kind: "site"; entity: SiteRecord }
		| { kind: "symbol"; entity: SymbolRecord }
		| { kind: "page"; entity: PageRecord }
		| { kind: "page_section"; entity: PageSectionRecord }
		| { kind: "page_type_section"; entity: PageTypeSectionRecord }
		| { kind: "page_type"; entity: PageTypeRecord }
): FieldRecord[] {
	if (target.kind === "site") return graph.siteFields.filter((field) => field.site === target.entity.id);
	if (target.kind === "symbol") return graph.symbolFields.filter((field) => field.symbol === target.entity.id);
	if (target.kind === "page") return graph.pageTypeFields.filter((field) => field.page_type === target.entity.page_type);
	if (target.kind === "page_type") return graph.pageTypeFields.filter((field) => field.page_type === target.entity.id);
	return graph.symbolFields.filter((field) => field.symbol === target.entity.symbol);
}

function entriesFor(
	graph: SiteGraph,
	target:
		| { kind: "site"; entity: SiteRecord }
		| { kind: "symbol"; entity: SymbolRecord }
		| { kind: "page"; entity: PageRecord }
		| { kind: "page_section"; entity: PageSectionRecord }
		| { kind: "page_type_section"; entity: PageTypeSectionRecord }
		| { kind: "page_type"; entity: PageTypeRecord }
): EntryRecord[] {
	if (target.kind === "site") return graph.siteEntries;
	if (target.kind === "symbol") return graph.symbolEntries;
	if (target.kind === "page") return graph.pageEntries.filter((entry) => entry.page === target.entity.id);
	if (target.kind === "page_type") return graph.pageTypeEntries;
	if (target.kind === "page_section") return graph.pageSectionEntries.filter((entry) => entry.section === target.entity.id);
	return graph.pageTypeSectionEntries.filter((entry) => entry.section === target.entity.id);
}

function localeContent(content: Record<string, Record<string, unknown>>, locale: string): Record<string, unknown> {
	content[locale] ??= {};
	return content[locale];
}

function resolveEntries(
	entries: EntryRecord[],
	field: FieldRecord,
	target:
		| { kind: "site"; entity: SiteRecord }
		| { kind: "symbol"; entity: SymbolRecord }
		| { kind: "page"; entity: PageRecord }
		| { kind: "page_section"; entity: PageSectionRecord }
		| { kind: "page_type_section"; entity: PageTypeSectionRecord }
		| { kind: "page_type"; entity: PageTypeRecord },
	parentEntry?: EntryRecord
): EntryRecord[] {
	return entries
		.filter((entry) => entry.field === field.id)
		.filter((entry) => {
			if ((target.kind === "page_section" || target.kind === "page_type_section") && entry.section !== target.entity.id) return false;
			return parentEntry ? entry.parent === parentEntry.id : !entry.parent;
		})
		.sort(sortByIndex);
}

function sectionKind(section: SectionRecord):
	| { kind: "page_section"; entity: PageSectionRecord }
	| { kind: "page_type_section"; entity: PageTypeSectionRecord } {
	return "page" in section
		? { kind: "page_section", entity: section }
		: { kind: "page_type_section", entity: section };
}

async function processCss(raw: string): Promise<string> {
	if (!raw) return "";
	if (cssCache.has(raw)) return cssCache.get(raw)!;
	const result = await postcss([postcssNested]).process(raw, { from: undefined });
	cssCache.set(raw, result.css);
	return result.css;
}

async function uploadTextFileField(
	apiUrl: string,
	token: string,
	collection: string,
	recordId: string,
	field: string,
	contents: string,
	fileName: string,
	contentType: string
): Promise<void> {
	const form = new FormData();
	form.append(field, new Blob([contents], { type: contentType }), fileName);

	const response = await fetch(`${apiUrl}/api/collections/${collection}/records/${recordId}`, {
		method: "PATCH",
		headers: {
			Authorization: token
		},
		body: form
	});
	if (!response.ok) {
		const body = await response.text().catch(() => "");
		throw new Error(`Failed to upload ${collection}.${field} for ${recordId} (HTTP ${response.status}): ${body || "no body"}`);
	}
}

function getEmptyValue(field: FieldRecord): unknown {
	if (field.type === "repeater") return [];
	if (field.type === "group") return {};
	if (field.type === "image") return { url: "", src: "", alt: "", size: null, width: null, height: null };
	if (field.type === "text") return "";
	if (field.type === "markdown") return "";
	if (field.type === "rich-text") return "";
	if (field.type === "link") return { label: "", text: "", url: "" };
	if (field.type === "url") return "";
	if (field.type === "select") return "";
	if (field.type === "switch") return true;
	if (field.type === "number") return 0;
	if (field.type === "page-list") return [];
	if (field.type === "icon") return "";
	return null;
}

function normalizeEntryValue(value: unknown): unknown {
	if (Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "number" && item >= 0 && item <= 255)) {
		const str = String.fromCharCode(...value);
		try {
			return JSON.parse(str);
		} catch {
			return str;
		}
	}

	if (Array.isArray(value)) return value.map((item) => normalizeEntryValue(item));
	if (value && typeof value === "object") {
		return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, normalizeEntryValue(child)]));
	}
	return value;
}

function renderRichTextFallback(value: unknown): string {
	if (typeof value === "string") return markdown.render(value);
	if (value && typeof value === "object" && Array.isArray((value as { content?: unknown[] }).content)) {
		return renderTipTapNodes((value as { content: unknown[] }).content);
	}
	return "";
}

function renderTipTapNodes(nodes: unknown[]): string {
	return nodes
		.map((node) => {
			if (!node || typeof node !== "object") return "";
			const typed = node as { type?: string; text?: string; content?: unknown[] };
			if (typed.type === "text") return escapeHtml(typed.text ?? "");
			const inner = Array.isArray(typed.content) ? renderTipTapNodes(typed.content) : "";
			if (typed.type === "paragraph") return `<p>${inner}</p>`;
			if (typed.type === "heading") return `<h2>${inner}</h2>`;
			if (typed.type === "bulletList") return `<ul>${inner}</ul>`;
			if (typed.type === "orderedList") return `<ol>${inner}</ol>`;
			if (typed.type === "listItem") return `<li>${inner}</li>`;
			if (typed.type === "blockquote") return `<blockquote>${inner}</blockquote>`;
			return inner;
		})
		.join("");
}

function pageMeta(graph: SiteGraph, page: PageRecord): Record<string, unknown> {
	return {
		created_at: page.created,
		name: page.name,
		slug: page.slug,
		url: buildLivePagePath(graph, page)
	};
}

function buildLivePagePath(graph: SiteGraph, page: PageRecord): string {
	const pathParts: string[] = [];
	let current: PageRecord | undefined = page;
	const seen = new Set<string>();

	while (current?.parent && !seen.has(current.id)) {
		seen.add(current.id);
		pathParts.push(current.slug);
		current = graph.pages.find((candidate) => candidate.id === current?.parent);
	}

	const pathName = pathParts.reverse().join("/");
	return pathName ? `/${pathName}` : "/";
}

function stringFromConfig(field: FieldRecord, key: string): string {
	const value = field.config?.[key];
	return typeof value === "string" ? value : "";
}

function sortByIndex<T extends { index?: number; id?: string }>(a: T, b: T): number {
	return (a.index ?? 0) - (b.index ?? 0);
}

function deduplicateById<T extends { id: string }>(items: T[]): T[] {
	return items.filter((item, index, array) => array.findIndex((candidate) => candidate.id === item.id) === index);
}

function safeJson(value: unknown): string {
	return JSON.stringify(value).replace(/</g, "\\u003c");
}

function escapeAttribute(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function cssStringEscape(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function jsStringEscape(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function escapeHtml(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
