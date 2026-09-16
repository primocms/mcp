// Regression test for null image/link entry values crashing build_preview.
//
// An image or link entry can persist in the CMS with a null value — e.g. an
// orphaned site_uploads record after its backing file in uploads/ is deleted.
// buildContent guarded against a *missing* entry but not against an entry whose
// value normalized to null: `value.upload` then threw
// "Cannot read properties of null (reading 'upload')", crashing the whole build
// (validate_site/validate_page still passed — the source files were valid).
// The image and link branches now null-guard before dereferencing, mirroring
// the page branch. This test drives the real content-building path with a null
// image and a null link entry and fails if either branch regresses.
//
// Run `npm run build` first (imports from dist/), then `npm run test:null-image`.

import { __test_buildSiteContent } from "../dist/tools/publish_compiler.js";

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

function emptyGraph(site) {
	return {
		site,
		pages: [],
		pageTypes: [],
		symbols: [],
		uploads: [],
		siteFields: [],
		symbolFields: [],
		pageTypeFields: [],
		siteEntries: [],
		symbolEntries: [],
		pageEntries: [],
		pageSections: [],
		pageSectionEntries: [],
		pageTypeSections: [],
		pageTypeSectionEntries: [],
		pageTypeEntries: []
	}
}

const site = { id: "site-1", name: "test" };
const graph = emptyGraph(site);

graph.siteFields = [
	{ id: "f-img", key: "hero", type: "image", site: "site-1" },
	{ id: "f-link", key: "cta", type: "link", site: "site-1" }
];

// Orphaned entries whose stored value normalizes to null — the crash trigger.
graph.siteEntries = [
	{ id: "e-img", field: "f-img", value: null },
	{ id: "e-link", field: "f-link", value: null }
];

let content;
try {
	content = __test_buildSiteContent(graph);
} catch (error) {
	throw new Error(`buildContent crashed on a null image/link value: ${error.message}`);
}

const en = content.en ?? {};

// Null image collapses to the empty-image value (same as a missing entry).
assert(en.hero && typeof en.hero === "object", "Expected an empty image object for the null image entry.");
assert(en.hero.url === "", `Expected empty image url, got ${JSON.stringify(en.hero.url)}.`);
assert(en.hero.alt === "", `Expected empty image alt, got ${JSON.stringify(en.hero.alt)}.`);

// Null link collapses to the empty-link value.
assert(en.cta && typeof en.cta === "object", "Expected an empty link object for the null link entry.");
assert(en.cta.url === "", `Expected empty link url, got ${JSON.stringify(en.cta.url)}.`);

console.log("null-image-value: ok — null image/link entries no longer crash the build.");
