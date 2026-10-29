import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { __test_buildSiteContent } from '../dist/tools/publish_compiler.js';
import { compile, fixture, publish } from './publish-cache-fixture.mjs';

const photo = { url: '/_uploads/photo.jpg', alt: 'Photo', width: 1600, height: 900, focal_point: { x: 0.25, y: 0.8 } };
const body = {
  type: 'doc', content: [
    { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'A heading' }] },
    { type: 'paragraph', content: [
      { type: 'text', text: 'Book & save', marks: [
        { type: 'link', attrs: { href: '/booking/?a=1&b=2', target: '_blank', rel: 'noopener', class: 'booking' } },
        { type: 'bold' }, { type: 'italic' }
      ] },
      { type: 'hardBreak' },
      { type: 'text', text: '<code>', marks: [{ type: 'code' }] },
      { type: 'text', text: 'Highlighted', marks: [{ type: 'highlight' }] },
      { type: 'text', text: 'Old', marks: [{ type: 'strike' }] },
      { type: 'text', text: 'Underlined', marks: [{ type: 'underline' }] }
    ] },
    { type: 'horizontalRule' },
    { type: 'orderedList', attrs: { start: 3 }, content: [
      { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Third' }] }] }
    ] }
  ]
};

function contentGraph(value = photo) {
  return {
    site: { id: 'site', name: 'Content' }, pages: [], pageTypes: [], symbols: [], uploads: [],
    siteFields: [{ id: 'photo', key: 'photo', type: 'image', site: 'site' }, { id: 'body', key: 'body', type: 'rich-text', site: 'site' }],
    siteEntries: [{ id: 'photo-value', field: 'photo', locale: 'en', value }, { id: 'body-value', field: 'body', locale: 'en', value: body }],
    symbolFields: [], pageTypeFields: [], symbolEntries: [], pageEntries: [], pageTypeEntries: [],
    pageSections: [], pageSectionEntries: [], pageTypeSections: [], pageTypeSectionEntries: []
  };
}

function assertRichText(html) {
  assert.match(html, /<h3>A heading<\/h3>/);
  const link = html.match(/<a\b[^>]*>/)?.[0];
  assert(link, 'rich-text link is present');
  for (const attribute of ['href="/booking/?a=1&amp;b=2"', 'target="_blank"', 'rel="noopener"', 'class="booking"']) assert(link.includes(attribute), attribute);
  assert.match(html, /<strong><em>Book &amp; save<\/em><\/strong>/);
  assert.match(html, /<br><code>&lt;code&gt;<\/code>/);
  assert.match(html, /<mark>Highlighted<\/mark><s>Old<\/s><u>Underlined<\/u>/);
  assert.match(html, /<hr><ol start="3"><li><p>Third<\/p><\/li><\/ol>/);
}

test('publish content retains image dimensions, nulls and uploaded-image resolution without changing source', () => {
  for (const dimensions of [{ width: 1600, height: 900 }, { width: null, height: null }, {}]) {
    const value = { url: '', upload: 'upload', alt: 'Photo', ...dimensions };
    const graph = contentGraph(value);
    graph.uploads = [{ id: 'upload', site: 'site', file: 'photo.jpg' }];
    const before = structuredClone(graph);
    const actual = __test_buildSiteContent(graph).en.photo;
    assert.equal(actual.url, '/_uploads/photo.jpg');
    assert.equal(actual.width, dimensions.width);
    assert.equal(actual.height, dimensions.height);
    assert.deepEqual(graph, before);
  }
});

test('publish content renders the CMS rich-text marks, attributes and node types', () => {
  assertRichText(__test_buildSiteContent(contentGraph()).en.body);
});

test('nested repeaters and localized values retain image dimensions and rich-text links', () => {
  const graph = contentGraph();
  graph.siteFields.unshift({ id: 'cards', key: 'cards', type: 'repeater', site: 'site' });
  graph.siteFields[1].parent = 'cards';
  graph.siteFields[2].parent = 'cards';
  graph.siteEntries.unshift({ id: 'card', field: 'cards', locale: 'fr', value: null });
  for (const entry of graph.siteEntries.slice(1)) { entry.parent = 'card'; entry.locale = 'fr'; }
  const content = __test_buildSiteContent(graph).en.cards[0];
  assert.equal(content.photo.width, 1600);
  assert.equal(content.photo.height, 900);
  assertRichText(content.body);
});

test('published SSR and hydration props preserve dimensions and rich text in shared layouts and page sections', async () => {
  const graph = fixture();
  graph.site_symbols[0].html = '<img src={photo.url} alt={photo.alt} width={photo.width} height={photo.height} /><article>{@html body}</article>';
  graph.site_symbols[0].js = 'let { photo = {}, body = "" } = $props();';
  graph.site_symbol_fields = ['photo', 'body'].map(key => ({ id: key, key, type: key === 'photo' ? 'image' : 'rich-text', symbol: 'hero' }));
  graph.page_section_entries = ['photo', 'body'].map(key => ({ id: `page-${key}`, section: 'section', field: key, locale: 'en', value: key === 'photo' ? photo : body }));
  graph.page_type_section_entries = ['photo', 'body'].map(key => ({ id: `header-${key}`, section: 'header', field: key, locale: 'en', value: key === 'photo' ? photo : body }));
  const before = structuredClone(graph);
  const artifacts = await compile(graph);
  for (const id of ['home', 'about']) {
    const html = artifacts.get(`pages/${id}/compiled_html`);
    assert.match(html, /<img[^>]*width="1600"[^>]*height="900"/);
    assertRichText(html);
    const props = [...html.matchAll(/props: (\{[^\n]+?\}) \}\);/g)].map(match => JSON.parse(match[1])).filter(props => props.photo);
    assert.equal(props.length, id === 'home' ? 2 : 1);
    for (const prop of props) {
      assert.equal(prop.photo.width, 1600);
      assert.equal(prop.photo.height, 900);
      assertRichText(prop.body);
    }
  }
  assert.deepEqual(graph.page_section_entries, before.page_section_entries);
  assert.deepEqual(graph.page_type_section_entries, before.page_type_section_entries);
});

test('a renderer upgrade rebuilds cached publications even when stored content is unchanged', async () => {
  const graph = fixture();
  await publish(graph);
  assert.equal((await publish(graph)).uploads.size, 0);
  const root = fileURLToPath(new URL('../', import.meta.url));
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'primo-renderer-upgrade-'));
  try {
    await fs.cp(path.join(root, 'dist'), path.join(dir, 'dist'), { recursive: true });
    await fs.writeFile(path.join(dir, 'package.json'), '{"type":"module"}');
    await fs.symlink(path.join(root, 'node_modules'), path.join(dir, 'node_modules'), 'junction');
    await fs.appendFile(path.join(dir, 'dist/tools/rich-text.js'), '\n// New renderer build.\n');
    const changed = await import(pathToFileURL(path.join(dir, 'dist/tools/publish_compiler.js')).href);
    const rebuilt = await publish(graph, { compiler: changed.compileAndUploadPublishArtifacts });
    assert.equal(rebuilt.summary.pagesCompiled, 2);
    assert.equal(rebuilt.summary.pagesSkipped, 0);
    assert.equal((await publish(graph, { compiler: changed.compileAndUploadPublishArtifacts })).uploads.size, 0);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
