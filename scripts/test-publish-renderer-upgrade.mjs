import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { fixture, publish } from './publish-cache-fixture.mjs';

test('a renderer upgrade rebuilds cached publications even when stored content is unchanged', async () => {
  const graph = fixture();
  await publish(graph);
  assert.equal((await publish(graph)).uploads.size, 0);
  const root = fileURLToPath(new URL('../', import.meta.url));
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'primo-renderer-upgrade-'));
  try {
    await fs.cp(path.join(root, 'dist'), path.join(dir, 'dist'), { recursive: true });
    await fs.copyFile(path.join(root, 'package.json'), path.join(dir, 'package.json'));
    await fs.symlink(path.join(root, 'node_modules'), path.join(dir, 'node_modules'), 'junction');
    await fs.appendFile(path.join(dir, 'dist/tools/publish-rich-text.js'), '\n// New renderer build.\n');
    const changed = await import(pathToFileURL(path.join(dir, 'dist/tools/publish_compiler.js')).href);
    const rebuilt = await publish(graph, { compiler: changed.compileAndUploadPublishArtifacts });
    assert.equal(rebuilt.summary.pagesCompiled, 2);
    assert.equal(rebuilt.summary.pagesSkipped, 0);
    assert.equal((await publish(graph, { compiler: changed.compileAndUploadPublishArtifacts })).uploads.size, 0);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('a renderer dependency version change invalidates unchanged compiler bytes', async () => {
  const graph = fixture();
  await publish(graph);
  assert.equal((await publish(graph)).uploads.size, 0);
  const root = fileURLToPath(new URL('../', import.meta.url));
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'primo-renderer-dependency-'));
  try {
    await fs.cp(path.join(root, 'dist'), path.join(dir, 'dist'), { recursive: true });
    await fs.copyFile(path.join(root, 'package.json'), path.join(dir, 'package.json'));
    await fs.mkdir(path.join(dir, 'node_modules'));
    for (const entry of await fs.readdir(path.join(root, 'node_modules'))) {
      if (entry !== 'markdown-it') await fs.symlink(path.join(root, 'node_modules', entry), path.join(dir, 'node_modules', entry), 'junction');
    }
    const require = createRequire(import.meta.url);
    const original = path.dirname(require.resolve('markdown-it/package.json'));
    const dependency = path.join(dir, 'node_modules/markdown-it');
    await fs.cp(original, dependency, { recursive: true });
    const metadata = JSON.parse(await fs.readFile(path.join(dependency, 'package.json'), 'utf8'));
    metadata.version += '-review-upgrade';
    await fs.writeFile(path.join(dependency, 'package.json'), JSON.stringify(metadata));
    const changed = await import(pathToFileURL(path.join(dir, 'dist/tools/publish_compiler.js')).href);
    const rebuilt = await publish(graph, { compiler: changed.compileAndUploadPublishArtifacts });
    assert.equal(rebuilt.summary.pagesCompiled, 2);
    assert.equal((await publish(graph, { compiler: changed.compileAndUploadPublishArtifacts })).uploads.size, 0);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
