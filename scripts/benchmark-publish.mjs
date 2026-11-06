// Real compilation and cache decisions against an in-memory API fixture.
// Excludes network latency, server-side copying, and live activation.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { fixture, publish } from './publish-cache-fixture.mjs';

const graph = fixture();
graph.pages = Array.from({ length: 130 }, (_, index) => ({
  id: index ? `page-${index}` : 'home', name: `Page ${index}`, slug: index ? `page-${index}` : '',
  parent: index ? 'home' : '', page_type: 'default', site: 'site', index
}));
graph.page_sections = graph.pages.flatMap((page, index) => [
  { id: `body-${index}`, page: page.id, symbol: 'hero', index: 0 },
  { id: `static-${index}`, page: page.id, symbol: 'static', index: 1 }
]);
graph.page_section_entries = graph.pages.map((page, index) => ({
  id: `entry-${index}`, section: `body-${index}`, field: 'headline', value: `Content for ${page.name}`, locale: 'en'
}));

async function run(scenario, expectedPages, expectedScripts) {
  const start = performance.now();
  const result = await publish(graph);
  assert.equal(result.summary.pagesCompiled, expectedPages);
  assert.equal(result.summary.symbolsCompiled, expectedScripts);
  console.log(JSON.stringify({ scenario, milliseconds: Math.round(performance.now() - start), ...result.summary }));
  return result;
}

const first = await run('initial publish', 130, 2);
await run('unchanged publish', 0, 0);
graph.page_section_entries[5].value = 'Edited page five';
const single = await run('one-page edit', 1, 0);
assert.equal(single.uploads.size, 1, 'only the edited page is uploaded');
for (const page of graph.pages.filter(page => page.id !== 'page-5')) {
  const key = `pages/${page.id}/compiled_html`;
  assert.equal(single.artifacts.get(key), first.artifacts.get(key));
}
graph.site_symbols[1].css = 'button { color: orange; }';
await run('shared footer edit', 130, 1);
await run('unchanged publish after footer edit', 0, 0);
