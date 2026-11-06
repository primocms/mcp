import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compile, fixture } from './publish-cache-fixture.mjs';

function sharedSite(mode = 'key') {
  const graph = fixture();
  graph.site_fields = [
    { id: 'nav_site_id', key: 'nav_links', type: 'repeater', site: 'site' },
    { id: 'nav-link', key: 'link', type: 'link', parent: 'nav_site_id', site: 'site' },
    { id: 'footer-id', key: 'footer_groups', type: 'repeater', site: 'site' },
    { id: 'footer-title', key: 'title', type: 'text', parent: 'footer-id', site: 'site' },
    { id: 'footer-links', key: 'links', type: 'repeater', parent: 'footer-id', site: 'site' },
    { id: 'footer-link', key: 'link', type: 'link', parent: 'footer-links', site: 'site' },
    { id: 'brand-id', key: 'brand', type: 'group', site: 'site' },
    { id: 'brand-name', key: 'name', type: 'text', parent: 'brand-id', site: 'site' },
    { id: 'logo-id', key: 'logo', type: 'image', site: 'site' },
    { id: 'notice-id', key: 'notice', type: 'text', site: 'site' },
    { id: 'count-id', key: 'count', type: 'number', site: 'site' },
    { id: 'enabled-id', key: 'enabled', type: 'switch', site: 'site' },
    { id: 'empty-id', key: 'empty', type: 'repeater', site: 'site' },
    // Colliding nested and other-site keys must never win over the owning root.
    { id: 'nested-nav', key: 'nav_links', type: 'text', parent: 'brand-id', site: 'site' },
    { id: 'foreign-nav', key: 'nav_links', type: 'text', site: 'elsewhere' }
  ];
  const entry = (id, field, value, parent) => ({ id, field, value, parent, locale: 'en' });
  graph.site_entries = [
    entry('nav-item', 'nav_site_id', null), entry('nav-value', 'nav-link', { page: 'about', label: 'About us' }, 'nav-item'),
    entry('footer-item', 'footer-id', null), entry('footer-heading', 'footer-title', 'Explore', 'footer-item'),
    entry('footer-list', 'footer-links', null, 'footer-item'), entry('footer-value', 'footer-link', { url: 'https://example.com/help', label: 'Help' }, 'footer-list'),
    entry('brand-value', 'brand-id', null), entry('name-value', 'brand-name', 'Primo shared', 'brand-value'),
    entry('logo-value', 'logo-id', { url: 'https://example.com/logo.svg', alt: 'Shared logo' }),
    entry('notice-value', 'notice-id', 'Shared copyright'), entry('count-value', 'count-id', 0), entry('enabled-value', 'enabled-id', false)
  ];
  graph.site_symbols = [
    { id: 'hero', site: 'site', name: 'Navigation', html: '<nav>{#each navigation as item}<a href={item.link.url} class:active={item.link.active}>{item.link.label}</a>{/each}</nav><span>{brand.name}</span><img src={logo.url} alt={logo.alt} />', js: 'let { navigation = [], brand = {}, logo = {} } = $props();', css: '' },
    { id: 'footer', site: 'site', name: 'Footer', html: '<footer>{#each groups as group}<h2>{group.title}</h2>{#each group.links as item}<a href={item.link.url}>{item.link.label}</a>{/each}{/each}<p>{notice}:{count}:{enabled}:{empty.length}</p></footer>', js: 'let { groups = [], notice = "", count = 0, enabled = false, empty = [] } = $props();', css: '' }
  ];
  const reference = (symbol, key, source) => ({ id: `${symbol}-${key}`, symbol, key, type: 'site-field', config: { field: mode === 'id' ? source.id : source.key } });
  const root = key => graph.site_fields.find(field => !field.parent && field.key === key);
  graph.site_symbol_fields = [
    ...[['navigation', 'nav_links'], ['brand', 'brand'], ['logo', 'logo']].map(([key, source]) => reference('hero', key, root(source))),
    ...[['groups', 'footer_groups'], ['notice', 'notice'], ['count', 'count'], ['enabled', 'enabled'], ['empty', 'empty']].map(([key, source]) => reference('footer', key, root(source)))
  ];
  graph.page_sections = [{ id: 'body', page: 'about', symbol: 'hero' }];
  graph.page_section_entries = [];
  graph.page_type_section_entries = [];
  return graph;
}

for (const mode of ['key', 'id']) {
  test(`${mode} references publish navigation, footer groups and shared values in HTML and hydration props without source changes`, async () => {
    const graph = sharedSite(mode);
    const sourceState = value => JSON.parse(JSON.stringify(value, (key, val) => key.startsWith('compiled_') || key === 'preview' ? undefined : val));
    const before = sourceState(graph);
    const artifacts = await compile(graph);
    for (const page of ['home', 'about']) {
      const html = artifacts.get(`pages/${page}/compiled_html`);
      assert.match(html, /href="\/about"[^>]*>About us<\/a>/);
      assert.match(html, /Explore/);
      assert.match(html, /href="https:\/\/example.com\/help"[^>]*>Help<\/a>/);
      assert.match(html, /Primo shared/);
      assert.match(html, /Shared copyright:0:false:0/);
      const props = [...html.matchAll(/props: (\{[^\n]+?\}) \}\);/g)].map(match => JSON.parse(match[1]));
      assert.equal(props.length, page === 'about' ? 3 : 2);
      const navigation = props.find(content => content.navigation);
      const footer = props.find(content => content.groups);
      assert.equal(navigation.navigation[0].link.active, page === 'about');
      assert.equal(navigation.logo.url, 'https://example.com/logo.svg');
      assert.equal(footer.groups[0].links[0].link.label, 'Help');
      assert.equal(footer.count, 0);
      assert.equal(footer.enabled, false);
      assert.deepEqual(footer.empty, []);
    }
    assert.deepEqual(sourceState(graph), before);
  });
}

test('ID match wins over a colliding key', async () => {
  const graph = sharedSite('id');
  graph.site_fields.push({ id: 'decoy', key: 'nav_site_id', type: 'text', site: 'site' });
  assert.match((await compile(graph)).get('pages/home/compiled_html'), /About us/);
});

for (const reference of ['missing', 'nav-link', 'foreign-nav', '', null]) {
  test(`invalid reference ${JSON.stringify(reference)} blocks every artifact upload with field and repair instructions`, async () => {
    const graph = sharedSite('id');
    // An unused nested field must also be caught by preflight.
    graph.site_symbol_fields.push({ id: 'bad-id', symbol: 'footer', parent: 'unused-group', key: 'broken', type: 'site-field', config: { field: reference } });
    const uploads = new Map();
    await assert.rejects(compile(graph, uploads), /site-field reference.*Footer.*broken.*bad-id.*config.field.*top-level.*site\/fields.yaml/);
    assert.equal(uploads.size, 0);
  });
}

test('ambiguous root keys fail instead of choosing an arbitrary value', async () => {
  const graph = sharedSite();
  graph.site_fields.push({ id: 'duplicate', key: 'nav_links', type: 'text', site: 'site' });
  await assert.rejects(compile(graph), /ambiguous site-field reference "nav_links"/);
});
