import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { __test_buildSiteContent, __test_compilePages } from '../dist/tools/publish_compiler.js';
import { resolveFieldValue } from '../dist/tools/resolve_field_value.js';
import { validateContentAgainstFields } from '../dist/validators/field-shapes.js';

function fixture() {
	return {
		site: { id: 'site', name: 'Images' },
		pages: [{ id: 'home', site: 'site', slug: '', page_type: 'default' }],
		pageTypes: [{ id: 'default', site: 'site' }],
		symbols: [{ id: 'hero', site: 'site', css: '', js: 'let count = 0;', html: '<img src={image.url} alt={image.alt} style:object-position={image.position} /><p>{image.focal_point.x},{image.focal_point.y}</p>' }],
		uploads: [{ id: 'upload', file: 'hero.jpg' }],
		siteFields: [{ id: 'image', key: 'image', type: 'image', site: 'site' }],
		siteEntries: [{ id: 'image-value', field: 'image', locale: 'en', value: { url: '', alt: 'Hero', upload: 'upload', focal_point: { x: 0.375, y: 0.62 } } }],
		symbolFields: [{ id: 'image-ref', key: 'image', type: 'site-field', symbol: 'hero', config: { field: 'image' } }],
		pageTypeFields: [], symbolEntries: [], pageEntries: [], pageTypeEntries: [],
		pageSections: [{ id: 'section', page: 'home', symbol: 'hero' }],
		pageSectionEntries: [], pageTypeSections: [], pageTypeSectionEntries: []
	};
}

test('preview content preserves focal points, resolves uploads and centers empty images', () => {
	const graph = fixture();
	graph.siteFields.push(
		{ id: 'cards', key: 'cards', type: 'repeater', site: 'site' },
		{ id: 'card-image', key: 'image', type: 'image', parent: 'cards', site: 'site' },
		{ id: 'missing', key: 'missing', type: 'image', site: 'site' },
		{ id: 'empty', key: 'empty', type: 'image', site: 'site' }
	);
	graph.siteEntries.push(
		{ id: 'card', field: 'cards', locale: 'en', value: null },
		{ id: 'nested-image', field: 'card-image', parent: 'card', locale: 'en', value: { url: '/nested.jpg', focal_point: { x: 0.1236, y: 0.9996 } } },
		{ id: 'empty-image', field: 'empty', locale: 'fr', value: null }
	);
	const authored = structuredClone(graph);
	const content = __test_buildSiteContent(graph);
	assert.equal(content.en.image.url, '/_uploads/hero.jpg');
	assert.deepEqual(content.en.image.focal_point, { x: 0.375, y: 0.62 });
	assert.equal(content.en.image.position, '37.5% 62%');
	assert.deepEqual(content.en.cards[0].image.focal_point, { x: 0.124, y: 1 });
	assert.equal(content.en.cards[0].image.position, '12.4% 100%');
	for (const image of [content.en.missing, content.fr.empty]) {
		assert.deepEqual(image.focal_point, { x: 0.5, y: 0.5 });
		assert.equal(image.position, '50% 50%');
	}
	assert.deepEqual(graph, authored);
});

test('preview clamps malformed coordinates and defaults older images to center', () => {
	for (const [focal_point, expected] of [
		[undefined, { x: 0.5, y: 0.5 }],
		[null, { x: 0.5, y: 0.5 }],
		[{ x: -0.4, y: 1.7 }, { x: 0, y: 1 }],
		[{ x: '0.2', y: Infinity }, { x: 0.5, y: 0.5 }],
		[{ x: NaN }, { x: 0.5, y: 0.5 }]
	]) {
		const graph = fixture();
		graph.siteEntries[0].value = { url: '/image.jpg', focal_point };
		assert.deepEqual(__test_buildSiteContent(graph).en.image.focal_point, expected);
	}
});

test('compiled HTML and hydration props agree on the focal point', async () => {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'primo-focal-point-'));
	try {
		const [{ html }] = await __test_compilePages(fixture(), dir);
		assert.match(html, /object-position:\s*37\.5% 62%/);
		assert.match(html, /<p>0\.375,0\.62<\/p>/);
		const props = JSON.parse(html.match(/props: (\{[^\n]+?\}) \}\);/)[1]);
		assert.deepEqual(props.image.focal_point, { x: 0.375, y: 0.62 });
		assert.equal(props.image.position, '37.5% 62%');
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
});

test('resolve_field_value keeps saved focal points and upload references', () => {
	const raw = { url: '', alt: 'Hero', upload: 'uploads/hero.jpg', width: 1600, height: 900, focal_point: { x: 0.25, y: 0.8 } };
	const saved = structuredClone(raw);
	const result = resolveFieldValue({ type: 'image', raw });
	assert.deepEqual(result.canonical, raw);
	assert.deepEqual(result.warnings, []);
	assert.deepEqual(raw, saved);
	assert.deepEqual(resolveFieldValue({ type: 'image', raw: { url: '/old.jpg', alt: '' } }).canonical, { url: '/old.jpg', alt: '' });
});

test('image validation and schema accept valid focal points and reject malformed ones', async () => {
	const fields = [{ name: 'image', type: 'image' }];
	const options = { file: 'content.yaml', context: 'content' };
	const schema = JSON.parse(await fs.readFile(new URL('../src/schemas/field.schema.json', import.meta.url), 'utf8'));
	const ajv = new Ajv2020({ strict: false });
	ajv.addSchema(schema, 'field.schema.json');
	const validate = ajv.compile({ $ref: 'field.schema.json#/$defs/imageValue' });
	for (const focal_point of [undefined, { x: 0, y: 1 }, { x: 0.25, y: 0.8 }]) {
		const image = { url: '', alt: 'Hero', ...(focal_point ? { focal_point } : {}) };
		assert.deepEqual(validateContentAgainstFields({ image }, fields, options), []);
		assert.equal(validate(image), true, JSON.stringify(validate.errors));
	}
	for (const focal_point of [null, [], { x: 0.2 }, { x: '0.2', y: 0.8 }, { x: -1, y: 2 }, { x: Infinity, y: 0.8 }]) {
		const image = { url: '/image.jpg', focal_point };
		assert(validateContentAgainstFields({ image }, fields, options).some(error => error.severity === 'error'));
		assert.equal(validate(image), false);
		assert(resolveFieldValue({ type: 'image', raw: image }).warnings.length > 0);
	}
});
