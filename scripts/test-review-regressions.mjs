import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fixture, publish } from './publish-cache-fixture.mjs';
import { getDevLogs, readGetDevLogsInput } from '../dist/tools/get_dev_logs.js';
import { read_dev_runtime } from '../dist/tools/dev-runtime.js';

test('multiple root pages keep one stable homepage preview and reach a no-op', async () => {
  const graph = fixture();
  graph.pages[1].parent = '';
  const first = await publish(graph);
  assert.equal(first.uploads.get('sites/site/preview'), first.uploads.get('pages/home/compiled_html'));
  assert.equal((await publish(graph)).uploads.size, 0);
  graph.pages[1].name = 'Changed second root';
  const changed = await publish(graph);
  assert(changed.uploads.has('pages/about/compiled_html'));
  assert(!changed.uploads.has('sites/site/preview'));
  assert.equal((await publish(graph)).uploads.size, 0);
});

test('repeated symbol sections retain their independent generated props', async () => {
  const graph = fixture();
  graph.site_symbols[0].html = '<h1>{typeof headline === "undefined" ? "" : headline}</h1>';
  graph.site_symbols[0].js = '';
  graph.page_sections.push({ id: 'second-hero', page: 'home', symbol: 'hero', index: 2 });
  graph.page_section_entries.push({ id: 'second-headline', section: 'second-hero', field: 'headline', value: 'Deuxieme', locale: 'fr' });
  const result = await publish(graph);
  assert.match(result.uploads.get('pages/home/compiled_html'), /First headline/);
});

test('unsupported rich text fails before any artifact upload', async () => {
  const graph = fixture();
  graph.site_symbol_fields.push({ id: 'body', key: 'body', type: 'rich-text', symbol: 'hero' });
  graph.page_section_entries.push({ id: 'body', section: 'section', field: 'body', locale: 'en', value: { type: 'doc', content: [{ type: 'unsupported-node' }] } });
  const uploads = new Map();
  await assert.rejects(publish(graph, { uploads }), /rich.text|Unknown node/i);
  assert.equal(uploads.size, 0);
});

test('top-level site aliases resolve their target without recursively rebuilding unrelated roots', async () => {
  const graph = fixture();
  graph.site_fields = [
    { id: 'notice', key: 'notice', type: 'text', site: 'site' },
    { id: 'alias', key: 'alias', type: 'site-field', site: 'site', config: { field: 'notice' } }
  ];
  graph.site_entries = [{ id: 'notice-value', field: 'notice', value: 'Shared message', locale: 'en' }];
  graph.site.head = '<title>{alias}</title>';
  const result = await publish(graph);
  assert.match(result.uploads.get('pages/home/compiled_html'), /Shared message/);
  graph.site_fields[0] = { id: 'notice', key: 'notice', type: 'site-field', site: 'site', config: { field: 'alias' } };
  const uploads = new Map();
  await assert.rejects(publish(graph, { uploads }), /Cyclic site-field reference/);
  assert.equal(uploads.size, 0);
});

test('log reads discard a truncated line with no newline and reject unknown input keys', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'primo-review-logs-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, '.primo'));
  await fs.writeFile(path.join(root, '.primo/dev.log'), 'x'.repeat(300 * 1024));
  const result = await getDevLogs({ site_path: root });
  assert.equal(result.text.length, 0);
  assert.equal(result.truncated, true);
  assert.throws(() => readGetDevLogsInput({ site_path: root, line: 1 }), /unknown|unexpected/i);
});

test('malformed CMS PIDs are rejected by the runtime reader', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'primo-review-pid-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, '.primo'));
  const runtime = { version: 1, workspace: await fs.realpath(root), pid: process.pid, cms_pid: 'not-an-integer', port: 3000, instance: 'test' };
  await fs.writeFile(path.join(root, '.primo/dev-server.json'), JSON.stringify(runtime));
  assert.equal(await read_dev_runtime(root), null);
});

for (const branch of ['page-field', 'page', 'page-list']) {
  test(`${branch} aliases detect cycles before uploading any artifacts`, async () => {
    const graph = fixture();
    graph.site_fields = [{ id: 'site-alias', key: 'alias', type: branch, site: 'site', config: branch === 'page-field' ? { field: 'page-alias' } : { page_type: 'default' } }];
    graph.page_type_fields = [{ id: 'page-alias', key: 'pageAlias', type: 'site-field', page_type: 'default', config: { field: 'site-alias' } }];
    if (branch === 'page') graph.site_entries = [{ id: 'page-link', field: 'site-alias', value: 'home', locale: 'en' }];
    const uploads = new Map();
    await assert.rejects(publish(graph, { uploads }), /Cyclic site-field reference/);
    assert.equal(uploads.size, 0);
  });
}
