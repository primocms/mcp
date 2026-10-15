import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { chromium } from '@playwright/test';
import { compile, fixture } from './publish-cache-fixture.mjs';

for (const reverse of [false, true]) {
  test(`published sections retain SSR DOM, head and CSS with ${reverse ? 'reversed' : 'normal'} module order`, async () => {
    const graph = fixture();
    graph.site.head = '<title>Client site</title>';
    const hero = graph.site_symbols[0];
    hero.html = '<svelte:head><meta name="section-title" content={headline}></svelte:head>{#each [headline] as text}<h1 class:active={active}>{text}</h1>{/each}<button onclick={() => count++}>{count}</button>';
    hero.js += ' let count = $state(0);';
    for (let i = 1; i < 5; i++) {
      graph.page_sections.push({ id: `repeat${i}`, page: 'home', symbol: 'hero', index: i + 1 });
      graph.page_section_entries.push({ id: `entry${i}`, section: `repeat${i}`, field: 'headline', value: `Client section ${i}`, locale: 'en' });
    }
    const uploads = await compile(graph);
    const html = uploads.get('pages/home/compiled_html');
    assert.match(html, /Client section 4/);
    let browser;
    const server = createServer(async (req, res) => {
      const symbol = new URL(req.url, 'http://localhost').pathname.match(/^\/_symbols\/(\w+)\.js$/)?.[1];
      if (symbol) {
        if ((symbol === 'hero') === reverse) await new Promise(resolve => setTimeout(resolve, 100));
        res.writeHead(200, { 'Content-Type': 'text/javascript' });
        res.end(uploads.get(`site_symbols/${symbol}/compiled_js`));
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
      }
    });
    try {
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      await page.addInitScript(() => document.addEventListener('readystatechange', () => {
        if (document.readyState === 'interactive') {
          window.ssrHeadings = [...document.querySelectorAll('h1')];
          window.ssrMeta = [...document.querySelectorAll('meta[name="section-title"]')];
        }
      }));
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.waitForFunction(() => document.querySelectorAll('h1.active').length === 6);
      assert.deepEqual(await page.locator('h1').allTextContents(), ['Header headline', 'First headline', 'Client section 1', 'Client section 2', 'Client section 3', 'Client section 4']);
      assert.equal(await page.evaluate(() => window.ssrHeadings.every((node, i) => node === document.querySelectorAll('h1')[i] && node.isConnected)), true);
      assert.equal(await page.evaluate(() => window.ssrMeta.every(node => node.isConnected)), true);
      assert.equal(await page.locator('meta[name="section-title"]').count(), 6);
      assert.equal(await page.title(), 'Client site');
      for (const button of await page.locator('button').all()) {
        await button.click();
        assert.equal(await button.textContent(), '1');
      }
      assert.equal(await page.locator('h1').first().evaluate(el => getComputedStyle(el).color), 'rgb(255, 0, 0)');
      assert.equal(await page.locator('footer button').evaluate(el => getComputedStyle(el).color), 'rgb(0, 0, 255)');
      assert.deepEqual(errors, []);
    } finally {
      await browser?.close();
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  });
}

// Page-level metadata must render even when all zones are empty.
test('empty pages keep site and page-type head content', async () => {
  const graph = fixture();
  graph.site.head = '<title>Empty client page</title>';
  graph.page_types[0].head = '<meta name="description" content="Kept on empty pages">';
  graph.page_sections = [];
  graph.page_type_sections = [];
  const uploads = await compile(graph);
  for (const id of ['home', 'about']) {
    const html = uploads.get(`pages/${id}/compiled_html`);
    assert.match(html, /<title>Empty client page<\/title>/);
    assert.match(html, /content="Kept on empty pages"/);
    assert.match(html, /data-primo-baseline/);
  }
});
