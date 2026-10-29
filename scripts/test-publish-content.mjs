import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { renderRichText } from '../dist/tools/publish-rich-text.js';
import { __test_buildSiteContent } from '../dist/tools/publish_compiler.js';
import { compile, fixture } from './publish-cache-fixture.mjs';

const text = (text, marks) => ({ type: 'text', text, ...(marks ? { marks } : {}) });
const paragraph = (...content) => ({ type: 'paragraph', content });
const document = {
  type: 'doc', content: [
    ...Array.from({ length: 6 }, (_, index) => ({ type: 'heading', attrs: { level: index + 1 }, content: [text(`Heading ${index + 1}`)] })),
    paragraph(text('Bold', [{ type: 'bold' }]), text(' Italic', [{ type: 'italic' }]), text(' Underline', [{ type: 'underline' }]),
      text(' Strike', [{ type: 'strike' }]), text(' Highlight', [{ type: 'highlight' }]), text(' Code <&>', [{ type: 'code' }]),
      { type: 'hardBreak' }, text('Booking', [{ type: 'link', attrs: { href: '/booking/?a=1&b=2', target: '_self', rel: 'author' } }]),
      text(' External', [{ type: 'bold' }, { type: 'link', attrs: { href: 'https://example.com', target: '_blank' } }]),
      text(' Still linked', [{ type: 'link', attrs: { href: 'https://example.com', target: '_blank' } }]),
      text('<script>alert("text")</script>')),
    { type: 'horizontalRule' },
    { type: 'orderedList', attrs: { start: 4 }, content: [{ type: 'listItem', content: [paragraph(text('Fourth'))] }] },
    { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph(text('Bullet'))] }] },
    { type: 'blockquote', content: [paragraph(text('Quote'))] },
    { type: 'codeBlock', attrs: { language: 'js' }, content: [text('x < y && y > 0')] },
    { type: 'image', attrs: { src: '/rich.jpg', alt: 'Rich image', title: 'A "title"', width: 400, height: 200 } },
    { type: 'youtube', attrs: { src: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', width: 640, height: 480 } }
  ]
};

test('rich text preserves the CMS schema marks, nodes and attributes', () => {
  const before = structuredClone(document);
  const html = renderRichText(document);
  for (let level = 1; level <= 6; level++) assert.match(html, new RegExp(`<h${level}>Heading ${level}</h${level}>`));
  for (const tag of ['strong', 'em', 'u', 's', 'mark', 'code', 'blockquote']) assert.match(html, new RegExp(`<${tag}[ >]`));
  assert.match(html, /href="\/booking\/\?a=1&amp;b=2"/);
  assert.match(html, /target="_self"/);
  assert.match(html, /rel="author"/);
  assert.match(html, /<br\s*\/?\s*>/);
  assert.match(html, /<hr\s*\/?\s*>/);
  assert.match(html, /<ol start="4">/);
  assert.match(html, /language-js/);
  assert.match(html, /width="400"/);
  assert.match(html, /youtube/);
  assert.doesNotMatch(html, /<script>/);
  assert.deepEqual(document, before);
});

test('static rendering matches the browser converter used by CMS publishing', async () => {
  const bundled = await build({
    stdin: { contents: `import { generateHTML } from '@tiptap/core'; import { publishRichTextExtensions } from './dist/tools/publish-rich-text.js'; window.cmsRender = doc => generateHTML(doc, publishRichTextExtensions);`, resolveDir: process.cwd() },
    bundle: true, write: false, format: 'iife', platform: 'browser'
  });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.addScriptTag({ content: bundled.outputFiles[0].text });
    const documents = [document, { type: 'doc', content: [paragraph(text('Unsafe', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }]))] }];
    for (const doc of documents) {
      const comparison = await page.evaluate(({ doc, actual }) => {
        const normalize = html => { const template = window.document.createElement('template'); template.innerHTML = html; return template.innerHTML; };
        return { actual: normalize(actual), expected: normalize(window.cmsRender(doc)) };
      }, { doc, actual: renderRichText(doc) });
      assert.equal(comparison.actual, comparison.expected);
    }
  } finally { await browser.close(); }
});

test('image dimensions survive locale, upload and nested site-field resolution without modifying stored data', () => {
  const graph = {
    site: { id: 'site' }, uploads: [{ id: 'upload', file: 'photo.jpg' }],
    siteFields: [{ id: 'photo', key: 'photo', type: 'image', site: 'site' }, { id: 'cards', key: 'cards', type: 'repeater', site: 'site' }, { id: 'nested', key: 'photo', type: 'image', parent: 'cards', site: 'site' }],
    siteEntries: [{ id: 'image', field: 'photo', locale: 'en', value: { upload: 'upload', alt: 'Photo', width: 1600, height: 900 } },
      { id: 'card', field: 'cards', locale: 'en' }, { id: 'nested-photo', field: 'nested', parent: 'card', locale: 'en', value: { url: '/nested.jpg', width: 640, height: 480 } }]
  };
  const before = structuredClone(graph);
  const content = __test_buildSiteContent(graph);
  assert.equal(content.en.photo.url, '/_uploads/photo.jpg');
  assert.equal(content.en.photo.width, 1600);
  assert.equal(content.en.photo.height, 900);
  assert.equal(content.en.cards[0].photo.width, 640);
  assert.equal(content.en.cards[0].photo.height, 480);
  assert.deepEqual(graph, before);
  const french = structuredClone(graph);
  french.siteEntries[0] = { id: 'french', field: 'photo', locale: 'fr', value: { url: '/fr.jpg', width: null, height: 0 } };
  assert.equal(__test_buildSiteContent(french).fr.photo.width, null);
  assert.equal(__test_buildSiteContent(french).fr.photo.height, 0);
});

test('published HTML and hydration props keep rich text and image dimensions', async () => {
  const graph = fixture();
  graph.site_symbols[0].html = '<img src={photo.url} alt={photo.alt} width={photo.width} height={photo.height} />{@html body}';
  graph.site_symbols[0].js = 'let { photo = {}, body = "" } = $props();';
  graph.site_symbol_fields = [{ id: 'photo', key: 'photo', type: 'image', symbol: 'hero' }, { id: 'body', key: 'body', type: 'rich-text', symbol: 'hero' }];
  graph.page_section_entries = [{ id: 'photo-entry', section: 'section', field: 'photo', locale: 'en', value: { url: '/photo.jpg', alt: 'Hero', width: 1600, height: 900 } },
    { id: 'body-entry', section: 'section', field: 'body', locale: 'en', value: document }];
  const html = (await compile(graph)).get('pages/home/compiled_html');
  assert.match(html, /width="1600" height="900"/);
  assert.match(html, /<h3>Heading 3<\/h3>/);
  assert.match(html, /<strong>Bold<\/strong>/);
  assert.match(html, /href="\/booking\/\?a=1&amp;b=2"/);
  const props = [...html.matchAll(/props: (\{[^\n]+?\}) \}\);/g)].map(match => JSON.parse(match[1]));
  const content = props.find(value => value.photo?.width === 1600);
  assert.equal(content.photo.height, 900);
  assert.equal(content.body, renderRichText(document));
});

