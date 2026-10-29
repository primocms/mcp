import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { compileAndUploadPublishArtifacts } from '../dist/tools/publish_compiler.js';

test('real CMS persists cache metadata, activates reused output and preserves live output on failure', {
  skip: !process.env.PRIMO_TEST_CMS_BINARY, timeout: 120000
}, async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'primo-incremental-cms-'));
  const reservation = net.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  let logs = '';
  const server = spawn(process.env.PRIMO_TEST_CMS_BINARY, ['serve', '--http', `127.0.0.1:${port}`, '--dir', directory], {
    env: { ...process.env, PRIMO_DEV_MODE: '1', PRIMO_AUTHOR_MODE: 'both', PRIMO_ENABLE_USAGE_STATS: 'false' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stdout.on('data', data => { logs += data; });
  server.stderr.on('data', data => { logs += data; });
  const nativeFetch = globalThis.fetch;
  let writes = [];
  globalThis.fetch = async (url, options) => {
    if (options?.body instanceof FormData) writes.push(new URL(url).pathname);
    return nativeFetch(url, options);
  };
  t.after(async () => {
    globalThis.fetch = nativeFetch;
    if (server.exitCode === null) {
      const stopped = once(server, 'close');
      server.kill('SIGTERM');
      await stopped;
    }
    await rm(directory, { recursive: true, force: true });
  });
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    try { if ((await fetch(`${origin}/api/health`)).ok) { ready = true; break; } } catch {}
    if (server.exitCode !== null) break;
    await delay(100);
  }
  assert(ready, logs);
  const auth = await fetch(`${origin}/api/primo/dev-auth`, { method: 'POST' }).then(response => response.json());
  assert(auth.token);
  async function request(route, body, method = 'POST') {
    const response = await fetch(`${origin}${route}`, { method: body === undefined ? 'GET' : method,
      headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const value = await response.json();
    assert(response.ok, `${route}: ${JSON.stringify(value)}`);
    return value;
  }
  const create = (collection, body) => request(`/api/collections/${collection}/records`, body);
  const group = await create('site_groups', { name: 'Incremental tests', index: 0 });
  const site = await create('sites', { name: 'Incremental', host: 'incremental.example', group: group.id });
  const type = await create('page_types', { name: 'Default', site: site.id, head: '', foot: '' });
  const symbol = await create('site_symbols', { name: 'Hero', site: site.id, html: '<h1>{headline}</h1><article>{@html body}</article><img src={photo.url} alt={photo.alt} width={photo.width} height={photo.height} />', css: 'h1 { color: red; }', js: 'let { headline, body, photo } = $props();' });
  await create('page_type_symbols', { page_type: type.id, symbol: symbol.id });
  const field = await create('site_symbol_fields', { symbol: symbol.id, key: 'headline', label: 'Headline', type: 'text', index: 0 });
  const bodyField = await create('site_symbol_fields', { symbol: symbol.id, key: 'body', label: 'Body', type: 'rich-text', index: 1 });
  const photoField = await create('site_symbol_fields', { symbol: symbol.id, key: 'photo', label: 'Photo', type: 'image', index: 2 });
  const body = { type: 'doc', content: [
    { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Third-level heading' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Book now', marks: [{ type: 'bold' }, { type: 'link', attrs: { href: '/booking/', target: '_self' } }] }, { type: 'hardBreak' }, { type: 'text', text: 'Next line' }] }
  ] };
  const home = await create('pages', { site: site.id, page_type: type.id, name: 'Home', slug: '', parent: '', index: 0 });
  const about = await create('pages', { site: site.id, page_type: type.id, name: 'About', slug: 'about', parent: home.id, index: 1 });
  const entries = [];
  for (const page of [home, about]) {
    const section = await create('page_sections', { page: page.id, symbol: symbol.id, index: 0 });
    entries.push(await create('page_section_entries', { section: section.id, field: field.id, value: `Original ${page.name}`, locale: 'en', index: 0 }));
    await create('page_section_entries', { section: section.id, field: bodyField.id, value: body, locale: 'en', index: 1 });
    await create('page_section_entries', { section: section.id, field: photoField.id, value: { url: '/photo.jpg', alt: 'Photo', width: 1600, height: 900 }, locale: 'en', index: 2 });
  }
  const route = `/api/primo/publication/${site.id}`;
  const live = () => fetch(`${origin}/?_site=${site.id}`).then(response => response.text());
  async function publish() {
    const before = await request(route);
    const attempt = await request(route, { expected_revision: before.draft_revision });
    const current = await request(`/api/collections/sites/records/${site.id}`);
    writes = [];
    try {
      const summary = await compileAndUploadPublishArtifacts(origin, auth.token, current);
      await request(`${route}/${attempt.attempt_id}/activate`, {});
      return summary;
    } catch (error) {
      await request(`${route}/${attempt.attempt_id}/fail`, { error: String(error) });
      throw error;
    }
  }
  assert.equal((await publish()).pagesCompiled, 2);
  assert.match(await live(), /Original Home/);
  assert.match(await live(), /<h3>Third-level heading<\/h3>/);
  assert.match(await live(), /href="\/booking\/"/);
  assert.match(await live(), /width="1600" height="900"/);
  const persisted = await request(`/api/collections/site_symbols/records/${symbol.id}`);
  assert.match(persisted.compiled_js_hash, /^[a-f0-9]{64}$/);
  assert.match(persisted.compiled_js, /^s_[a-f0-9]{32}_[a-f0-9]{64}_[a-z0-9]{10}\.js$/);
  const noop = await publish();
  assert.equal(noop.pagesCompiled, 0);
  assert.equal(noop.symbolsCompiled, 0);
  assert.equal(writes.length, 0);
  await request(`/api/collections/page_section_entries/records/${entries[1].id}`, { value: 'Edited About' }, 'PATCH');
  const isolated = await publish();
  assert.equal(isolated.pagesCompiled, 1);
  assert.equal(isolated.symbolsCompiled, 0);
  assert.deepEqual(writes, [`/api/collections/pages/records/${about.id}`]);
  assert.match(await fetch(`${origin}/about?_site=${site.id}`).then(response => response.text()), /Edited About/);
  await request(`/api/collections/site_symbols/records/${symbol.id}`, { css: 'h1 { color: blue; }' }, 'PATCH');
  const shared = await publish();
  assert.equal(shared.pagesCompiled, 2);
  assert.equal(shared.symbolsCompiled, 1);
  if (process.env.PRIMO_TEST_EDITOR === '1') {
    const { chromium } = await import('@playwright/test');
    const browser = await chromium.launch({ headless: true });
    try {
      const editor = await browser.newPage();
      await editor.addInitScript(({ token, record }) => localStorage.setItem('pocketbase_auth', JSON.stringify({ token, record })), auth);
      await editor.goto(`${origin}/admin/sites/${site.id}`);
      let browserWrites = [];
      editor.on('request', request => {
        if (request.method() === 'PATCH' && request.headers()['content-type']?.includes('multipart/form-data')) {
          const pathname = new URL(request.url()).pathname;
          if (/\/collections\/(pages|site_symbols|sites)\/records\//.test(pathname)) browserWrites.push(pathname);
        }
      });
      async function publishInEditor() {
        browserWrites = [];
        await editor.getByRole('button', { name: 'Preview', exact: true }).click();
        await editor.getByRole('button', { name: 'Build preview', exact: true }).click();
        await editor.getByRole('heading', { name: 'Preview ready', exact: true }).waitFor({ timeout: 60000 });
        await editor.getByRole('button', { name: 'Done', exact: true }).click();
        return [...browserWrites];
      }
      async function compiledContent() {
        const record = await request(`/api/collections/pages/records/${home.id}`);
        const html = await nativeFetch(`${origin}/api/files/pages/${home.id}/${record.compiled_html}`, { headers: { Authorization: `Bearer ${auth.token}` } }).then(response => response.text());
        return editor.evaluate(html => {
          const doc = new DOMParser().parseFromString(html, 'text/html');
          const photo = doc.querySelector('img');
          return { body: doc.querySelector('article').innerHTML.replace(/<!--.*?-->/gs, ''), image: [photo.getAttribute('src'), photo.getAttribute('alt'), photo.getAttribute('width'), photo.getAttribute('height')] };
        }, html);
      }
      const nodeContent = await compiledContent();
      const browserFirst = await publishInEditor();
      assert.deepEqual(await compiledContent(), nodeContent, 'CMS and Node publication must preserve the same rich-text markup and image dimensions');
      assert.equal(browserFirst.filter(route => route.includes('/pages/')).length, 2, 'switching producers invalidates cached output');
      assert.deepEqual(await publishInEditor(), [], 'same-session editor publication must reuse saved file metadata without realtime');
      await request(`/api/collections/page_section_entries/records/${entries[1].id}`, { value: 'Another About edit' }, 'PATCH');
      await editor.reload();
      assert.deepEqual(await publishInEditor(), [`/api/collections/pages/records/${about.id}`]);
      // Returning to the Node compiler must invalidate browser-produced files.
      assert.equal((await publish()).pagesCompiled, 2);
    } finally { await browser.close(); }
  }
  const beforeFailure = await live();
  await request(`/api/collections/site_symbols/records/${symbol.id}`, { js: 'const invalid = ;' }, 'PATCH');
  await assert.rejects(publish());
  assert.equal(await live(), beforeFailure);
  assert.equal((await request(route)).state, 'failed');
});
