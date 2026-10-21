import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, publish, imports } from './publish-cache-fixture.mjs';

const pageWrites = result => [...result.uploads.keys()].filter(key => key.endsWith('/compiled_html'));
const scriptWrites = result => [...result.uploads.keys()].filter(key => key.endsWith('/compiled_js'));

test('a fresh publish populates persistent caches; a no-op compiles and uploads nothing', async () => {
  const graph = fixture();
  const first = await publish(graph);
  assert.deepEqual(first.summary, { pageCount: 2, symbolCount: 2, pagesCompiled: 2, pagesSkipped: 0, symbolsCompiled: 2, symbolsSkipped: 0 });
  const next = await publish(graph);
  assert.equal(next.summary.pagesCompiled, 0);
  assert.equal(next.summary.symbolsCompiled, 0);
  assert.equal(next.uploads.size, 0);
  assert.deepEqual(next.artifacts, first.artifacts);
});

test('one page edit uploads only that page; reused bundles retain their exact output versions', async () => {
  const graph = fixture();
  const first = await publish(graph);
  graph.page_section_entries[0].value = 'Edited headline';
  const changed = await publish(graph);
  assert.deepEqual(pageWrites(changed), ['pages/home/compiled_html']);
  assert.equal(scriptWrites(changed).length, 0);
  assert(changed.artifacts.get('pages/home/compiled_html').includes('Edited headline'));
  assert.deepEqual(imports(changed.artifacts.get('pages/home/compiled_html')), imports(first.artifacts.get('pages/home/compiled_html')));
  assert.equal(changed.artifacts.get('pages/about/compiled_html'), first.artifacts.get('pages/about/compiled_html'));
  // An independently rebuilt graph must produce the exact same public HTML.
  const fresh = structuredClone(graph);
  for (const page of fresh.pages) page.compiled_html_hash = '';
  for (const symbol of fresh.site_symbols) symbol.compiled_js_hash = '';
  const full = await publish(fresh);
  for (const page of graph.pages) assert.equal(changed.artifacts.get(`pages/${page.id}/compiled_html`), full.artifacts.get(`pages/${page.id}/compiled_html`));
});

test('HTML and CSS changes to a static block invalidate its page without compiling scripts', async () => {
  const graph = fixture();
  await publish(graph);
  for (const edit of [() => { graph.site_symbols[2].html = '<p>Updated static block</p>'; }, () => { graph.site_symbols[2].css = 'p { color: orange; }'; }]) {
    edit();
    const result = await publish(graph);
    assert.deepEqual(pageWrites(result), ['pages/home/compiled_html']);
    assert.equal(scriptWrites(result).length, 0);
    assert(result.artifacts.get('pages/home/compiled_html').includes('Updated static block'));
  }
});

test('shared block changes rebuild its dependent pages and only its own client bundle', async () => {
  const graph = fixture();
  await publish(graph);
  graph.site_symbols[1].css = 'button { color: orange; }';
  const result = await publish(graph);
  assert.equal(pageWrites(result).length, 2);
  assert.deepEqual(scriptWrites(result), ['site_symbols/footer/compiled_js']);
  assert.equal((await publish(graph)).uploads.size, 0);
});

test('removing JavaScript invalidates HTML and removes the old hydration import', async () => {
  const graph = fixture();
  await publish(graph);
  graph.site_symbols[0].js = '';
  graph.site_symbols[0].html = '<h1>{headline}</h1>';
  const result = await publish(graph);
  assert.equal(pageWrites(result).length, 2);
  assert.equal(scriptWrites(result).length, 0);
  assert(imports(result.artifacts.get('pages/home/compiled_html')).every(url => !url.includes('/hero.js')));
});

test('layout, section ordering, resolved page links, and site head changes invalidate output', async () => {
  const graph = fixture();
  graph.site_symbol_fields.push({ id: 'link', key: 'link', type: 'link', symbol: 'hero' });
  graph.site_symbols[0].js = graph.site_symbols[0].js.replace('headline = ""', 'headline = "", link = {}');
  graph.site_symbols[0].html += '<a href={link.url}>{link.label}</a>';
  graph.page_type_section_entries.push({ id: 'nav-link', section: 'header', field: 'link', value: { page: 'about', label: 'About' }, locale: 'en' });
  await publish(graph);
  graph.pages[1].slug = 'renamed';
  const renamed = await publish(graph);
  assert.equal(pageWrites(renamed).length, 2);
  assert(renamed.artifacts.get('pages/home/compiled_html').includes('href="/renamed"'));
  graph.page_sections.reverse();
  graph.page_sections[0].index = -1;
  assert.deepEqual(pageWrites(await publish(graph)), ['pages/home/compiled_html']);
  graph.page_types[0].head = '<meta name="test" content="changed">';
  assert.equal(pageWrites(await publish(graph)).length, 2);
  graph.site.head = '<meta name="global" content="changed">';
  assert.equal(pageWrites(await publish(graph)).length, 2);
});

test('missing artifacts rebuild, while a failed preview upload is repaired on retry', async () => {
  const graph = fixture();
  await publish(graph);
  graph.pages[1].compiled_html = '';
  assert.deepEqual(pageWrites(await publish(graph)), ['pages/about/compiled_html']);
  graph.site_symbols[0].compiled_js = '';
  const scriptRepair = await publish(graph);
  assert.deepEqual(scriptWrites(scriptRepair), ['site_symbols/hero/compiled_js']);
  assert.equal(pageWrites(scriptRepair).length, 0, 'identical repaired bundles retain their output version');
  graph.page_section_entries[0].value = 'New home';
  await assert.rejects(publish(graph, { failUpload: collection => collection === 'sites' }), /Failed to upload/);
  const repaired = await publish(graph);
  assert(repaired.uploads.has('sites/site/preview'));
  assert.equal((await publish(graph)).uploads.size, 0);
});

test('legacy file replacements and incompatible hashes cannot falsely hit the cache', async () => {
  const graph = fixture();
  await publish(graph);
  // An older publisher can replace an artifact without changing its hash field.
  graph.pages[1].compiled_html = 'index_1234567890.html';
  graph.site_symbols[1].compiled_js = 'symbol_1234567890.js';
  const legacy = await publish(graph);
  assert.deepEqual(pageWrites(legacy), ['pages/about/compiled_html']);
  assert.deepEqual(scriptWrites(legacy), ['site_symbols/footer/compiled_js']);
  graph.pages[1].compiled_html_hash = 'different-producer';
  assert.deepEqual(pageWrites(await publish(graph)), ['pages/about/compiled_html']);
  // Older server schemas continue to work via full compilation.
  for (const page of graph.pages) delete page.compiled_html_hash;
  for (const symbol of graph.site_symbols) delete symbol.compiled_js_hash;
  assert.equal(pageWrites(await publish(graph)).length, 2);
  assert.equal(pageWrites(await publish(graph)).length, 2);
});

test('failed script uploads cannot publish page HTML against uncommitted bundles', async () => {
  const graph = fixture();
  await publish(graph);
  const oldHash = graph.site_symbols[0].compiled_js_hash;
  const oldHtmlHash = graph.pages[0].compiled_html_hash;
  graph.site_symbols[0].css = 'h1 { color: lime; }';
  await assert.rejects(publish(graph, { failUpload: collection => collection === 'site_symbols' }), /Failed to upload/);
  assert.equal(graph.site_symbols[0].compiled_js_hash, oldHash);
  assert.equal(graph.pages[0].compiled_html_hash, oldHtmlHash);
  assert.equal(pageWrites(await publish(graph)).length, 2);
});

test('page creation and removal refresh page-list consumers', async () => {
  const graph = fixture();
  graph.site_fields = [{ id: 'list', site: 'site', key: 'pages', type: 'page-list', config: { page_type: 'default' } }];
  graph.site.head = '<meta name="page-count" content={pages.length}>';
  await publish(graph);
  graph.pages.push({ id: 'new', name: 'New', slug: 'new', parent: 'home', page_type: 'default', site: 'site', compiled_html_hash: '' });
  const added = await publish(graph);
  assert.equal(pageWrites(added).length, 3);
  assert(added.artifacts.get('pages/home/compiled_html').includes('content="3"'));
  graph.pages.pop();
  assert.equal(pageWrites(await publish(graph)).length, 2);
});
