# Recommended defaults

Opt-in baseline opinions for building out a fresh Primo site. None of these are enforced — `validate_*` will accept a site without any of them. They exist because most real sites end up needing them, and an agent building a site from scratch should consider them up front.

## Baseline CSS

Primo automatically injects a small baseline reset into every built page (zero margins on body/headings/paragraphs/lists, `box-sizing: border-box`, `img { display: block; max-width: 100% }`, `a { color: inherit }`, system font stack). It's emitted as `<style data-primo-baseline>` before the site's own `head.svelte`, so block authors can assume those defaults without restating them.

Don't redeclare the reset in `site/head.svelte` — it's already there. Override individual rules only when a design needs something different (e.g. restoring `list-style: disc` for a content-heavy block).

## Site fields (`site/fields.yaml`)

Most sites want a small set of site-wide fields the editor can manage centrally.

- `logo` — image
- `nav` — repeater of `{ label: text, url: link }`
- `footer` — group with `{ tagline: text, copyright: text }` or similar
- `social` — repeater of `{ platform: text, url: url }`
- Contact info if relevant — email, phone, address as text or link

Skip any that don't apply. A pure marketing landing page might only need `logo`.

## Page-type config (`page-types/{name}/config.yaml`)

Set `color` on each page type — the editor uses it to badge pages in the sidebar. Pick a unique hex from the Primo palette (see `scaffold_page_type` description for the full list). Without a color, the badge renders empty.

## Page-type basics

Each page type's `config.yaml` should set:

- `name` — display name shown in the editor.
- `icon` — Iconify icon name (e.g. `mdi:file-document-outline`).
- `color` — hex color (e.g. `#2B407D`) used by the editor to badge this page type. Pick an unused color from the palette so types are visually distinguishable.

## Page-type fields (`page-types/{name}/fields.yaml`)

Page-level field definitions live in a sibling `fields.yaml` — the same bare-list shape used by block fields and `site/fields.yaml`. Per-page metadata most sites benefit from; SEO trio is the strongest baseline.

- `seo_title` — text (overrides page name in `<title>`)
- `seo_description` — text
- `og_image` — image (social share preview)

For specific page types you'll often want more:

- Blog post page type: `author` (text or page reference), `published_at` (date), `summary` (text), `cover_image` (image)
- Product page type: `price` (number), `sku` (text), `gallery` (repeater of image)

## Blocks and `allowed_blocks`

Two kinds of blocks live in `blocks/`:

- **Reusable blocks** — meant to be dragged into pages by the editor. Add their folder name to the page type's `allowed_blocks` list. Without that, the block exists but is invisible in the sidebar.
- **Single-use blocks** — header, footer, one-off promo. These live in `blocks/` but stay out of `allowed_blocks`. The page references them directly in `sections:`.

When you scaffold a new block, decide which kind it is and wire it accordingly. Forgetting to update `allowed_blocks` for a reusable block is the single most common mistake.

## Wiring checklist

When building out a site from a fresh `primo new` scaffold:

1. Add site fields the design depends on (logo, nav, footer at minimum).
2. For each page type, add the SEO trio plus any type-specific fields.
3. For each page type, scaffold a header block and a footer block (unless the site is intentionally chromeless), wire them in `layout.yaml`, and seed sensible default body content based on the site's purpose. Don't repeat them in individual `pages/*.yaml`.
4. For each reusable block, add it to the relevant page type's `allowed_blocks`.
5. Run `validate_page` on each page and `validate_block` on each block.
