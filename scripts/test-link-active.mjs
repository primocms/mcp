import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { __test_buildSiteContent, __test_compilePages } from '../dist/tools/publish_compiler.js';

function fixture() {
	const site = { id: 'site', name: 'Navigation' };
	const pages = [
		{ id: 'home', name: 'Home', slug: '', parent: '', page_type: 'default', site: site.id },
		{ id: 'about', name: 'About', slug: 'about', parent: 'home', page_type: 'default', site: site.id },
		{ id: 'child', name: 'Child', slug: 'child', parent: 'about', page_type: 'default', site: site.id }
	];
	const graph = {
		site, pages, uploads: [], symbolEntries: [], pageTypeEntries: [],
		pageTypes: [{ id: 'default', name: 'Default', site: site.id }],
		symbols: [{ id: 'nav-block', site: site.id, css: '', js: 'let count = 0;', html: `<nav>{#each nav as item}<a href={item.group.link.url} class:active={item.group.link.active}>{item.group.link.label}</a>{/each}</nav>` }],
		siteFields: [
			{ id: 'nav', key: 'nav', type: 'repeater', site: site.id },
			{ id: 'group', key: 'group', type: 'group', parent: 'nav', site: site.id },
			{ id: 'link', key: 'link', type: 'link', parent: 'group', site: site.id },
			{ id: 'featured', key: 'featured', type: 'page', site: site.id },
			{ id: 'listing', key: 'listing', type: 'page-list', config: { page_type: 'default' }, site: site.id },
			{ id: 'empty', key: 'empty', type: 'link', site: site.id },
			{ id: 'null', key: 'null_link', type: 'link', site: site.id }
		],
		symbolFields: [{ id: 'nav-ref', key: 'nav', type: 'site-field', config: { field: 'nav' }, symbol: 'nav-block' }],
		pageTypeFields: [{ id: 'page-link', key: 'cta', type: 'link', page_type: 'default' }],
		siteEntries: [
			{ id: 'featured-value', field: 'featured', value: 'about' },
			{ id: 'null-value', field: 'null', value: null }
		],
		pageEntries: pages.map(page => ({ id: `cta-${page.id}`, field: 'page-link', page: page.id, value: { page: 'home', label: 'Go home' } })),
		pageSections: [{ id: 'body', page: 'about', symbol: 'nav-block' }],
		pageSectionEntries: [],
		pageTypeSections: [{ id: 'header', page_type: 'default', symbol: 'nav-block', zone: 'header' }],
		pageTypeSectionEntries: []
	};
	const values = [
		...pages.map(page => ({ page: page.id, label: page.name, active: true })),
		{ url: '/about', label: 'URL', active: true },
		{ url: 'https://example.com', label: 'External', active: true },
		{ page: 'deleted', label: 'Deleted', active: true },
		{ url: '', label: 'Empty', active: true }
	];
	values.forEach((value, index) => {
		graph.siteEntries.push(
			{ id: `item-${index}`, field: 'nav', value: null, index },
			{ id: `group-${index}`, field: 'group', parent: `item-${index}`, value: null },
			{ id: `link-${index}`, field: 'link', parent: `group-${index}`, value }
		);
	});
	return graph;
}

test('active follows the viewed page through nested and referenced content', () => {
	const graph = fixture();
	const authored = structuredClone(graph);
	for (const page of graph.pages) {
		const content = __test_buildSiteContent(graph, { page }).en;
		assert.deepEqual(content.nav.filter(item => item.group.link.active).map(item => item.group.link.label), [page.name]);
		// A referenced page/list item's own identity must not replace the viewed page.
		assert.equal(content.featured.cta.active, page.id === 'home');
		assert(content.listing.every(item => item.cta.active === (page.id === 'home')));
		assert.equal(content.empty.active, false);
		assert.equal(content.null_link.active, false);
	}
	const preview = __test_buildSiteContent(graph).en;
	assert(preview.nav.every(item => item.group.link.active === false));
	assert.equal(preview.featured.cta.active, false);
	assert(preview.listing.every(item => item.cta.active === false));
	assert.deepEqual(graph, authored);
});

test('published HTML and hydration props agree on the active navigation link', async () => {
	const graph = fixture();
	// Also exercise links exposed through page-field references.
	graph.symbolFields.push({ id: 'cta-ref', key: 'cta', type: 'page-field', config: { field: 'page-link' }, symbol: 'nav-block' });
	graph.symbols[0].html += '<a data-cta href={cta.url} class:active={cta.active}>{cta.label}</a>';
	const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'primo-link-active-'));
	try {
		const artifacts = await __test_compilePages(graph, tempDir);
		for (const { pageId, html } of artifacts) {
			const page = graph.pages.find(page => page.id === pageId);
			const copies = pageId === 'about' ? 2 : 1;
			const activeLabels = [...html.matchAll(/<a\b[^>]*class="[^"]*\bactive\b[^"]*"[^>]*>([^<]*)<\/a>/g)].map(match => match[1]);
			assert.deepEqual(activeLabels, Array.from({ length: copies }, () => pageId === 'home' ? [page.name, 'Go home'] : [page.name]).flat());
			const props = [...html.matchAll(/props: (\{[^\n]+?\}) \}\);/g)].map(match => JSON.parse(match[1]));
			assert.equal(props.length, copies);
			for (const content of props) {
				assert.deepEqual(content.nav.filter(item => item.group.link.active).map(item => item.group.link.label), [page.name]);
				assert.equal(content.cta.active, pageId === 'home');
			}
		}
	} finally {
		await fs.rm(tempDir, { recursive: true, force: true });
	}
});
