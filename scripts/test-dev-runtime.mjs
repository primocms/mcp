import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildPreview } from '../dist/tools/build_preview.js';

async function fixture(t, { stale = false, configured = true } = {}) {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'primo-mcp-runtime-'));
 t.after(() => fs.rm(root, { recursive: true, force: true }));
 const workspace = await fs.realpath(root);
 const site = path.join(root, 'sites/demo');
 await fs.mkdir(site, { recursive: true });
 await fs.mkdir(path.join(root, '.primo'));
 await fs.writeFile(path.join(root, 'server.yaml'), configured ? 'port: 3000\n' : '{}\n');
 await fs.writeFile(path.join(site, 'site.yaml'), 'site_id: demo\n');
 const runtime = { version: 1, workspace, pid: process.pid, port: 43002, instance: 'current' };
 await fs.writeFile(path.join(root, '.primo/dev-server.json'), JSON.stringify(runtime));
 const original = globalThis.fetch;
 const urls = [];
 globalThis.fetch = async url => {
  urls.push(String(url));
  if (String(url) === 'http://127.0.0.1:43003/__primo/runtime') return Response.json({ ...runtime, instance: stale ? 'other' : 'current' });
  if (String(url) === 'http://127.0.0.1:43002/api/primo/dev-auth') return Response.json({ token: 'dev' });
  if (String(url) === 'http://127.0.0.1:43002/api/collections/sites/records/demo') return Response.json({}, { status: 404 });
  throw new Error(`Unexpected request: ${url}`);
 };
 t.after(() => { globalThis.fetch = original; });
 return { site, urls };
}

for (const configured of [true, false]) {
 test(`MCP preview uses session port with ${configured ? 'explicit' : 'default'} configuration`, async t => {
  const { site, urls } = await fixture(t, { configured });
  await assert.rejects(buildPreview({ site_path: site }), /Site demo was not found.*43002/);
  assert.equal(urls.length, 3);
 });
}

test('MCP preview refuses stale identity without probing other servers', async t => {
 const { site, urls } = await fixture(t, { stale: true });
 await assert.rejects(buildPreview({ site_path: site }), /no longer reachable/);
 assert.deepEqual(urls, ['http://127.0.0.1:43003/__primo/runtime']);
});
