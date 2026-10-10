import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { compile, fixture, imports } from './publish-cache-fixture.mjs';

const page = artifacts => artifacts.get('pages/home/compiled_html');
const heroUrl = artifacts => imports(page(artifacts))[0];

test('all page imports name the exact uploaded bytes, including shared zones', async () => {
  const artifacts = await compile(fixture());
  for (const id of ['home', 'about']) {
    const html = artifacts.get(`pages/${id}/compiled_html`);
    assert.equal(imports(html).length, 2, 'one import per interactive symbol, including header/footer');
    for (const url of imports(html)) {
      const [, symbol, version] = url.match(/^\/_symbols\/(\w+)\.js\?v=([a-f0-9]{64})$/) ?? [];
      assert(symbol, `Unversioned import: ${url}`);
      assert.equal(version, createHash('sha256').update(artifacts.get(`site_symbols/${symbol}/compiled_js`)).digest('hex'));
    }
    assert(!html.includes('/_symbols/static.js'));
    assert(!html.includes('v=undefined'));
  }
  assert.equal(imports(page(artifacts))[0], imports(artifacts.get('pages/about/compiled_html'))[0]);
  assert.equal(artifacts.get('sites/site/preview'), page(artifacts));
});

test('CSS, markup and JS edits invalidate only changed bundles; content edits reuse them', async () => {
  const graph = fixture();
  const first = await compile(graph);
  assert.equal(heroUrl(await compile(graph)), heroUrl(first));
  graph.page_section_entries[0].value = 'Updated headline';
  const content = await compile(graph);
  assert(page(content).includes('Updated headline'));
  assert.equal(heroUrl(content), heroUrl(first));
  const beforeClass = page(content).match(/<h1 class="([^"]+)"/)[1];
  graph.site_symbols[0].css = 'h1 { color: green; font-size: 48px; } img { border-radius: 24px; object-fit: contain; }';
  const css = await compile(graph);
  assert.notEqual(heroUrl(css), heroUrl(content));
  assert.notEqual(page(css).match(/<h1 class="([^"]+)"/)[1], beforeClass);
  graph.site_symbols[0].html += '<img alt="Hero" src="data:,hero" />';
  const markup = await compile(graph);
  assert.notEqual(heroUrl(markup), heroUrl(css));
  graph.site_symbols[0].js = graph.site_symbols[0].js.replace('active = true', 'active = false');
  const js = await compile(graph);
  assert.notEqual(heroUrl(js), heroUrl(markup));
  for (const artifacts of [content, css, markup, js]) {
    assert.equal(imports(page(artifacts))[1], imports(page(first))[1], 'unaffected footer retains its cache key');
  }
});
