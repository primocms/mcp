# Head & SEO

How Primo assembles each published page's `<head>`, and how to implement per-page SEO (`<title>`, meta description, Open Graph/Twitter tags) with page-type head fragments.

## How the head is assembled

Every published page's `<head>` is built by concatenating three parts, in this order, into a single generated `<svelte:head>`:

1. Primo's baseline CSS reset (`<style data-primo-baseline>`) — always first.
2. `site/head.svelte` — included on every page.
3. `page-types/{name}/head.svelte` — included on pages of that type.

The concatenated markup is compiled as one Svelte fragment with field data in scope (next section). `site/foot.html` is different: it is appended verbatim before `</body>` with no templating at all.

## Data scope: bare identifiers, no `<script>`

Head fragments are **markup only**. They are pasted into a generated wrapper component, so they cannot declare their own `<script>` block or call `$props()` — a `<script>` tag you write in a head fragment is emitted as a literal browser script, never executed at build time.

Both `site/head.svelte` and `page-types/{name}/head.svelte` receive the same data: **site field values merged with the current page's field values** (page values win on key collision). Each field key is pre-declared as a bare identifier.

```svelte
<!-- CORRECT: bare identifier, works in site or page-type head -->
<title>{seo_title || 'Acme — Handmade Furniture'}</title>

<!-- WRONG: fails at publish time -->
<script>
	let { fields } = $props()
</script>
<title>{fields?.seo_title}</title>
```

Rules that follow from this:

- Reference fields as bare identifiers: `seo_title`, not `fields.seo_title`.
- Only defined field keys are in scope. Referencing an identifier that is not a site field or a field of the current page's type throws `ReferenceError: <name> is not defined` at publish time.
- Svelte template syntax works: `{expression}`, `{#if}`, `{@html}`.
- Do not wrap the file in `<svelte:head>` — validation rejects it; the wrapper is added for you.
- `<style>` blocks in head fragments become global styles (they are real `<style>` elements in the head, not component-scoped CSS).
- Inline JSON-LD must be wrapped in `{@html}`, because raw `{` braces inside a `<script type="application/ld+json">` parse as Svelte expressions:

```svelte
{@html `<script type="application/ld+json">{
	"@context": "https://schema.org",
	"@type": "Organization",
	"name": "Acme"
}</script>`}
```

## Exactly one `<title>`

Two facts drive how titles work:

- **There is no automatic `<title>`.** The published HTML shell contains only charset, viewport, and generator meta. A page whose head fragments emit no `<title>` publishes without one. Defining a `seo_title` field does nothing by itself — a page-type head must render it.
- **Duplicate `<title>` tags are deduplicated, first wins.** Site and page-type head render into one `<svelte:head>`, and Svelte's server renderer keeps only the first `<title>` it encounters. Since `site/head.svelte` comes first, a title there **silently suppresses** any page-type title — even one wrapped in `{#if}`.

So: put `<title>` only in page-type heads, with a fallback for pages that leave the field empty:

```svelte
<title>{seo_title || 'Acme — Handmade Furniture'}</title>
```

Other tags are **not** deduplicated — two `<meta name="description">` tags both render. Keep each tag in exactly one place: site-wide tags in `site/head.svelte`, per-page tags in the page-type head.

## Per-page SEO recipe

1. Add SEO fields to the page type (`page-types/{name}/fields.yaml`):

```yaml
- label: SEO Title
  name: seo_title
  type: text
- label: SEO Description
  name: seo_description
  type: text
- label: OG Image
  name: og_image
  type: image
```

2. Render them in `page-types/{name}/head.svelte`:

```svelte
<title>{seo_title || 'Acme — Handmade Furniture'}</title>
<meta name="description" content={seo_description || 'Solid-wood furniture, made to order.'} />
<meta property="og:type" content="website" />
<meta property="og:title" content={seo_title || 'Acme — Handmade Furniture'} />
<meta property="og:description" content={seo_description || 'Solid-wood furniture, made to order.'} />
{#if og_image?.url}
	<meta property="og:image" content={og_image.url.startsWith('http') ? og_image.url : 'https://example.com' + og_image.url} />
{/if}
<meta name="twitter:title" content={seo_title || 'Acme — Handmade Furniture'} />
<meta name="twitter:description" content={seo_description || 'Solid-wood furniture, made to order.'} />
```

3. Keep `site/head.svelte` page-agnostic — fonts, favicon, global `<style>`, `og:site_name`, `twitter:card`, theme-color. No `<title>`, no description, no per-page OG tags.

4. Set values per page in `pages/*.yaml` under the page-level `fields:` key:

```yaml
fields:
    seo_title: Dining Tables — Acme
    seo_description: Made-to-order dining tables in oak and walnut.
```

The page URL is not available in head scope, so a canonical link needs an explicit field (e.g. a `seo_path` text field) rendered as `{#if seo_path}<link rel="canonical" href={'https://example.com' + seo_path} />{/if}`.

## foot.html

`site/foot.html` is static HTML injected before `</body>` on every page — no Svelte templating, no field data. Use it for analytics and other end-of-body scripts:

```html
<script defer src="https://analytics.example.com/script.js" data-website-id="..."></script>
```

`page-types/{name}/foot.html` round-trips through pull/push but is **not currently included** in published pages — use `site/foot.html`.

## Quick reference

| File | Applies to | Templating | Data in scope | Typical use |
| --- | --- | --- | --- | --- |
| `site/head.svelte` | every page | Svelte markup, no `<script>` | site + current page fields (bare identifiers) | fonts, favicon, global CSS, `og:site_name`, `twitter:card` |
| `page-types/{name}/head.svelte` | pages of that type | Svelte markup, no `<script>` | site + current page fields (bare identifiers) | `<title>`, meta description, OG/Twitter tags, canonical, robots |
| `site/foot.html` | every page, before `</body>` | none — verbatim HTML | none | analytics scripts |
| `page-types/{name}/foot.html` | — | not rendered into published output | — | avoid for now |

## Gotchas

- A page with no sections in any zone (no page-type header/footer, no body sections) renders no head content at all — head fragments only render through the page's sections.
- The `primo build` static export (for Netlify/Vercel/etc.) follows this doc's semantics on primo-cli 0.1.21+, including `site/foot.html`. Older CLI versions diverge: they prepend their own `<title>` (`Page Name | Site Name`), insert head fragments without evaluating Svelte expressions, and omit `site/foot.html`.
- After editing head files, run `build_preview` and check the page source — a dropped title or a raw `{expression}` in the output means one of the rules above was violated.
