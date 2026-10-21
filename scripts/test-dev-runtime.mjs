import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildPreview } from '../dist/tools/build_preview.js';
import { getDevStatus } from '../dist/tools/get_dev_status.js';
import { getDevLogs, readGetDevLogsInput } from '../dist/tools/get_dev_logs.js';

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
 return { site, urls, workspace, runtime };
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

test('MCP status verifies server identity before reporting running, independently of import snapshots', async t => {
 const { site, runtime, workspace } = await fixture(t);
 const starting = await getDevStatus({ site_path: site });
 assert.equal(starting.running, true);
 assert.equal(starting.ok, false); // No first import yet.
 assert.equal(starting.pid, runtime.pid);
 assert.equal(await fs.realpath(starting.workspace), workspace);
 await fs.mkdir(path.join(site, '.primo'));
 await fs.writeFile(path.join(site, '.primo/sync_status.json'), JSON.stringify({ ok: true }));
 assert.equal((await getDevStatus({ site_path: site })).running, true);
 await fs.writeFile(path.join(workspace, '.primo/dev-server.json'), JSON.stringify({ ...runtime, instance: 'stale' }));
 const stale = await getDevStatus({ site_path: site });
 assert.equal(stale.running, false);
 assert.equal(stale.process_alive, true);
 assert.match(stale.message, /do not start a duplicate/);
 await fs.unlink(path.join(workspace, '.primo/dev-server.json'));
 const stopped = await getDevStatus({ site_path: site });
 assert.equal(stopped.running, false);
 assert.equal(stopped.process_alive, false);
 assert.equal(stopped.ok, true); // Preserve the historical import result.
 assert.match(stopped.message, /historical/);
 assert.doesNotMatch(stopped.message, /All file content is in the CMS/);
});

test('MCP reads workspace logs after shutdown, including rotation, without starting processes', async t => {
 const { site, workspace } = await fixture(t);
 await fs.unlink(path.join(workspace, '.primo/dev-server.json'));
 const file = path.join(workspace, '.primo/dev.log');
 const missing = await getDevLogs({ site_path: site });
 assert.equal(missing.available, false);
 await fs.writeFile(file, 'stdout context\nstderr failure\n');
 await fs.writeFile(file + '.1', 'previous context\n');
 const latest = await getDevLogs(readGetDevLogsInput({ site_path: site, lines: 1 }));
 assert.equal(latest.text, 'stderr failure\n');
 assert.equal(latest.truncated, true);
 assert.equal(await fs.realpath(latest.log_file), file);
 assert.equal((await getDevLogs({ site_path: site, previous: true })).text, 'previous context\n');
 assert.throws(() => readGetDevLogsInput({ site_path: site, lines: 0 }), /1 to 1000/);
 assert.throws(() => readGetDevLogsInput({ site_path: site, lines: '10' }), /1 to 1000/);
 assert.throws(() => readGetDevLogsInput({ site_path: site, previous: 'false' }), /boolean/);
});
