import assert from 'node:assert/strict';
import { compileAndUploadPublishArtifacts } from '../dist/tools/publish_compiler.js';

export function fixture() {
  return {
    site: { id: 'site', name: 'Preview' },
    pages: [
      { id: 'home', name: 'Home', slug: '', parent: '', page_type: 'default', site: 'site' },
      { id: 'about', name: 'About', slug: 'about', parent: 'home', page_type: 'default', site: 'site' }
    ],
    page_types: [{ id: 'default', name: 'Default', site: 'site' }],
    site_symbols: [
      { id: 'hero', site: 'site', html: '<h1 class:active={active}>{headline}</h1><img class:active={active} alt="Hero" src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=" />', js: 'import { onMount } from "svelte"; let { headline = "" } = $props(); let active = $state(false); onMount(() => { active = true; });', css: 'h1 { color: red; font-size: 32px; } img { border-radius: 8px; object-fit: cover; }' },
      { id: 'footer', site: 'site', html: '<button onclick={() => count++}>{count}</button>', js: 'let count = $state(0);', css: 'button { color: blue; }' },
      { id: 'static', site: 'site', html: '<p>Static block</p>', js: '', css: 'p { color: purple; }' }
    ],
    site_symbol_fields: [{ id: 'headline', key: 'headline', type: 'text', symbol: 'hero' }],
    page_sections: [{ id: 'section', page: 'home', symbol: 'hero', index: 0 }, { id: 'static-section', page: 'home', symbol: 'static', index: 1 }],
    page_section_entries: [{ id: 'entry', section: 'section', field: 'headline', value: 'First headline', locale: 'en' }],
    page_type_sections: [{ id: 'header', page_type: 'default', symbol: 'hero', zone: 'header', index: 0 }, { id: 'footer-section', page_type: 'default', symbol: 'footer', zone: 'footer', index: 0 }],
    page_type_section_entries: [{ id: 'header-entry', section: 'header', field: 'headline', value: 'Header headline', locale: 'en' }]
  };
}

// Exercise the public entry point used by preview and CLI hosted publication,
// capturing multipart uploads rather than test-only compiler output.
export async function compile(fixture) {
  const uploads = new Map();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const match = new URL(url).pathname.match(/^\/api\/collections\/([^/]+)\/records(?:\/([^/]+))?$/);
    assert(match, `Unexpected request: ${url}`);
    const [, collection, id] = match;
    if (!id) return Response.json({ items: fixture[collection] ?? [], totalPages: 1 });
    assert.equal(options.method, 'PATCH');
    for (const [field, file] of options.body.entries()) uploads.set(`${collection}/${id}/${field}`, await file.text());
    return Response.json({ id });
  };
  try {
    const summary = await compileAndUploadPublishArtifacts('http://compiler.test', 'token', fixture.site);
    assert.deepEqual(summary, { pageCount: 2, symbolCount: 2 });
    return uploads;
  } finally { globalThis.fetch = originalFetch; }
}

export function imports(html) {
  return [...html.matchAll(/import\('([^']+)'\)/g)].map(match => match[1]);
}
