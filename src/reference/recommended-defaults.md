# Recommended defaults

Best practices for structuring a Primo site around the editor's needs: choosing site, page, and block fields; deciding which blocks editors can add; and defining page types. Read this before creating a site or changing its content structure. These are design defaults, not validation requirements; adapt them to the site's needs and the user's instructions.

## Choose where content belongs

Give editors one clear place to manage each value. Choose its scope by who owns the content and where it is used, not by which component happens to render it.

| Scope | Use when | Examples | How blocks read it |
| --- | --- | --- | --- |
| Site fields | A value is managed centrally across the site. | Logo, navigation links, contact details, social links | A `site-field` reference with `config.field` set to the site field name |
| Page fields | A value describes the page, especially if multiple blocks or other pages need it. | Title, summary, cover image, author, publication date, SEO metadata | A `page-field` reference with `config.field` set to the page field name |
| Block fields | A value belongs to one section instance and can differ between instances. | Testimonial quotes, feature lists, CTA text | The section's own field values |

Define site fields in `site/fields.yaml` and their values in `site/content.yaml`. Define page fields in `page-types/{name}/fields.yaml` and populate each page's top-level `fields:` in `pages/*.yaml`. Define block fields in `blocks/{name}/fields.yaml` and populate each section's `content:`.

For example, a post's title and cover image belong in page fields so its hero and article listing can use the same content. A promotional section's heading belongs in block fields if editors should customize each instance. Navigation should reference site fields so changing a link does not require editing every page or page-type layout.

Use `site-field` and `page-field` references instead of copying centrally managed values into each section. Block `content.yaml` supplies preview and insertion defaults only; changing those defaults does not update existing sections. See `content-model` and `field-types` for the exact file shapes and reference syntax.

## Choose page types by editing needs

Create a page type when pages need a different field schema, shared layout, or set of blocks editors can add. Posts, Products, and Landing Pages are useful examples. Reuse an existing type when only content or minor styling differs; do not create a type for every page by default.

- **Fixed structure:** use an empty `allowed_blocks` list when editors should edit content within a predefined structure. The type's body sections are locked against adding, removing, and reordering.
- **Flexible structure:** list only the blocks editors should be able to insert. Editors can compose the page body from those options.

An empty `allowed_blocks` list makes the whole page type static. Excluding one block from a non-empty list only removes it from the add-block picker; it does not enforce a one-instance limit or lock that section in place.

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

Each page type's `config.yaml` should set:

- `name` — display name shown in the editor.
- `icon` — Iconify icon name (e.g. `mdi:file-document-outline`).
- `color` — hex color (e.g. `#2B407D`) used by the editor to badge this page type. Pick an unused color from the palette so types are visually distinguishable.

## Page-type fields (`page-types/{name}/fields.yaml`)

Page-level field definitions live in a sibling `fields.yaml` — the same bare-list shape used by block fields and `site/fields.yaml`. Per-page metadata most sites benefit from; SEO trio is the strongest baseline.

- `seo_title` — text (rendered into `<title>` by the page type's `head.svelte` — there is no automatic title from the page name; see `head-and-seo.md`)
- `seo_description` — text
- `og_image` — image (social share preview)

For specific page types you'll often want more:

- Blog post page type: `author` (text or page reference), `published_at` (date), `summary` (text), `cover_image` (image)
- Product page type: `price` (number), `sku` (text), `gallery` (repeater of image)

## Blocks and `allowed_blocks`

The block availability toggles on a page type control `allowed_blocks`: the blocks offered in the editor's add-block picker. They are not a list of every block used by the page type. Before enabling a block, ask: **Should an editor be able to add another instance of this block to the page body?**

- **Shared layout blocks:** put Navigation and Footer in `layout.yaml` under `header:` and `footer:`. Keep them out of `allowed_blocks` by default, and do not repeat them in individual pages. Their implementation can be reused across page types without making them insertable body sections.
- **Once-per-page or one-off sections:** place a Hero directly in a page's `sections:`, or in `layout.yaml` under `body:` to seed it onto new pages. Keep it out of `allowed_blocks` when editors are not meant to add another hero. Existing pages need their own sections updated; changing layout `body:` only affects newly created pages.
- **Repeatable body sections:** add Testimonials, Feature Grids, CTAs, and similar blocks to the relevant page type's `allowed_blocks` when editors should be able to insert them. Otherwise they will not appear in the add-block picker.

Choose based on intended use, not the block's name. A hero-style promotional section can be repeatable; a particular CTA can be fixed. Keeping a block out of the picker does not prevent a page or layout from referencing it.

For a flexible landing page with shared Navigation/Footer and an initial Hero, `allowed_blocks` might be `[features, testimonials, cta]`. The layout supplies Navigation/Footer and seeds Hero; the picker offers only the sections editors should add.

## Wiring checklist

When creating a site or changing its content structure:

1. Inspect existing fields, blocks, and page types, and reuse them where their purpose fits.
2. Assign each editable value to site, page, or block scope. Add only fields the site needs, and wire references to shared values.
3. Choose page types by field schema, layout, and editing needs. Consider the SEO trio and any type-specific fields.
4. Put shared Navigation/Footer in each relevant type's `layout.yaml`, reusing the same blocks where appropriate. Seed initial body sections if useful; update existing pages separately.
5. Review every `allowed_blocks` entry against whether editors should be able to add another instance. Leave layout blocks and once-per-page heroes out unless that is intentionally supported.
6. Run `validate_page` on affected pages, `validate_block` on affected blocks, and `validate_site` for site-level changes. Then review the editing experience: centrally managed content has one source, page fields describe the page, and the picker offers useful additions. Passing validation alone does not establish a good content model.
