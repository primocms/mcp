import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { chromium } from '@playwright/test';
import { compile, fixture, imports } from './publish-cache-fixture.mjs';

test('a warm browser cache reproduces the legacy mismatch and versioned rebuilds prevent it', async () => {
  const graph = fixture();
  const before = await compile(graph);
  graph.site_symbols[0].css = 'h1 { color: green; font-size: 48px; } img { border-radius: 24px; object-fit: contain; }';
  const after = await compile(graph);
  let current = before;
  let legacy = true;
  const scriptRequests = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const symbol = url.pathname.match(/^\/_symbols\/(\w+)\.js$/)?.[1];
    if (symbol) {
      scriptRequests.push(req.url);
      res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'public, max-age=3600' });
      res.end(current.get(`site_symbols/${symbol}/compiled_js`));
    } else {
      let html = current.get('pages/home/compiled_html');
      if (legacy) html = html.replaceAll(/\.js\?v=[a-f0-9]{64}/g, '.js');
      res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
      res.end(html);
    }
  });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ headless: true });
    const origin = `http://127.0.0.1:${server.address().port}`;
    for (const versioned of [false, true]) {
      legacy = !versioned;
      current = before;
      const context = await browser.newContext();
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(origin + '/?visit=before');
      await page.locator('#section-section h1.active').waitFor();
      assert.equal(await page.locator('#section-section h1').evaluate(el => getComputedStyle(el).color), 'rgb(255, 0, 0)');
      const requestsBefore = scriptRequests.length;
      current = after;
      // Ordinary navigation keeps HTTP caching enabled. Playwright routing or
      // disabling CDP cache would hide the original bug.
      await page.goto(origin + '/?visit=after');
      await page.locator('#section-section h1.active').waitFor();
      const color = await page.locator('#section-section h1').evaluate(el => getComputedStyle(el).color);
      if (versioned) {
        assert.equal(color, 'rgb(0, 128, 0)');
        assert.equal(await page.locator('#section-section h1').evaluate(el => getComputedStyle(el).fontSize), '48px');
        assert.equal(await page.locator('#section-section img').evaluate(el => getComputedStyle(el).borderRadius), '24px');
        assert.equal(await page.locator('#section-section img').evaluate(el => getComputedStyle(el).objectFit), 'contain');
        assert(scriptRequests.slice(requestsBefore).includes(imports(after.get('pages/home/compiled_html'))[0]));
        assert.deepEqual(errors, []);
      } else {
        assert.notEqual(color, 'rgb(0, 128, 0)', 'legacy stale bundle overwrites the new CSS scope class');
        assert.equal(scriptRequests.length, requestsBefore, 'the legacy bundle really was cached');
        const fresh = await browser.newContext();
        const freshPage = await fresh.newPage();
        await freshPage.goto(origin);
        await freshPage.locator('#section-section h1.active').waitFor();
        assert.equal(await freshPage.locator('#section-section h1').evaluate(el => getComputedStyle(el).color), 'rgb(0, 128, 0)');
        await fresh.close();
      }
      await context.close();
    }
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
