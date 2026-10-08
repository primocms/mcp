# Field Types

Field definitions use this shape:

```yaml
- name: headline
  label: Headline
  type: text
  config: {}
```

These entries appear inside three files, all of which are **bare top-level lists** of field definitions (no wrapper object):

- `blocks/{name}/fields.yaml` — block field schema
- `page-types/{name}/fields.yaml` — page-level fields (e.g. `seo_title`, `og_image`)
- `site/fields.yaml` — site-wide fields

`name` is the Svelte prop name and should be a valid identifier using letters, numbers, and underscores. Exported files use `config`. `options` is accepted by import for older files, but new edits should use `config`.

## text

Single-line or short text. Component value is a string.

```svelte
<h1 data-key="headline">{headline}</h1>
```

## rich-text

WYSIWYG editor. Component value renders as HTML, so use `{@html ...}`. In YAML content, rich text may be TipTap JSON or markdown/plain text; Primo normalizes it when rendering.

```svelte
{@html content}
```

## markdown

Markdown editor. Component value renders as HTML.

```svelte
{@html body}
```

## image

Image upload or external image. Component values include `url`, `alt`, `focal_point`, and `position`.

Two ways to supply the image:

### External URL

```yaml
image:
  url: https://example.com/hero.jpg
  alt: Barber at work
  width: 1600
  height: 900
```

### Local file in `uploads/`

Drop the file into the site's `uploads/` folder, then reference it from yaml using the `upload:` slot with a path starting with `uploads/`:

```yaml
image:
  url: ""
  alt: Barber at work
  upload: uploads/hero.jpg
```

On push, the server creates a `site_uploads` record, stores the binary, and rewrites `upload:` to the record's ID. The local file is also renamed to its canonical (suffixed) name to round-trip cleanly on subsequent pulls — e.g. `uploads/hero.jpg` becomes `uploads/hero_a8x2j9.jpg`. After the first push, your yaml will show `upload: <record-id>` and the renderer will resolve it automatically; do not edit the ID by hand.

Leave `url: ""` when using `upload:` — the renderer fills it in from the stored file. To switch from a local upload to an external URL, set `url:` and remove `upload:`.

Render the resolved value the same way regardless of source:

```svelte
{#if image?.url}
  <img src={image.url} alt={image.alt} data-key="image" />
{/if}
```

Image values can store an optional `focal_point: { x, y }`, with both coordinates
as fractions from 0 to 1 of the original image. A missing point means the center.
The editor stores the point on the field entry, so one upload can have different
focal points in different fields. Preserve it when editing the image's URL or alt
text; `resolve_field_value` keeps both the point and the upload reference.

Blocks receive a normalized `focal_point` and a derived CSS `position` string,
including on empty images. Coordinates are clamped to 0..1 and rounded to three
decimals when rendering. For example, `{ x: 0.375, y: 0.62 }` gives `"37.5% 62%"`;
missing or malformed coordinates default to `0.5` (`"50% 50%"` at the center).
Use `position` to keep the selected point visible when cropping:

```svelte
{#if image?.url}
  <img src={image.url} alt={image.alt} style:object-fit="cover" style:object-position={image.position} />
{/if}
```

`position` is derived for rendering; store only `focal_point` in YAML content.

Optional image config:

```yaml
config:
  maxSizeMB: 1
  maxWidthOrHeight: 1920
```

## link

URL or internal page link with a label. Component value is `{ url, label, text, active }`.

Two shapes in exported source:

- **External link** — set `url`, omit `page`:

  ```yaml
  cta:
    url: https://example.com
    label: Visit us
  ```

- **Internal page link** — set `page` to the page's `_id`, omit `url`. Primo resolves
  `page` → the current `url` from that page's slug/path at build time, so the link
  follows the page when its slug changes. Do NOT hand-write a `url` alongside `page`
  for internal links — it's unnecessary and freezes the link against slug changes.

  ```yaml
  nav_link:
    label: About
    page: a3qvuy5z3q24p7y
  ```

Either shape produces the same `{ url, label, text, active }` value in the component. Because
an internal link can resolve to an empty string transiently (while its page loads),
always guard: `{#if link?.url}` and `link?.label`.

```svelte
{#if cta?.url}
  <a href={cta.url} data-key="cta">{cta.label}</a>
{/if}
```

`active` is computed when rendering: it is `true` only when a `page` reference
points to the current page. URL-only, missing, and empty links are inactive, as
are previews without a current page. Shared navigation resolves separately for
each page. Do not store `active` in YAML content.

```svelte
{#if nav_link?.url}
  <a href={nav_link.url} class:active={nav_link.active}
     aria-current={nav_link.active ? 'page' : undefined}>
    {nav_link.label}
  </a>
{/if}
```

## url

Plain URL string.

```svelte
<a href={website_url}>Visit</a>
```

## icon

Icon picker. Component value is an SVG string.

```svelte
{@html icon}
```

## number

Numeric input. Component value is a number.

```yaml
- name: columns
  label: Columns
  type: number
  config:
    min: 1
    max: 6
    step: 1
```

## switch

Boolean toggle.

```svelte
{#if show_title}
  <h1>{title}</h1>
{/if}
```

## select

Dropdown selection. Component value is the selected option value.

```yaml
- name: align
  label: Alignment
  type: select
  config:
    options:
      - value: left
        label: Left
      - value: center
        label: Center
      - value: right
        label: Right
```

```svelte
<div class="text-{align}">{content}</div>
```

## repeater

List of items with nested fields. Component value is an array of objects.

```yaml
- name: features
  label: Features
  type: repeater
  subfields:
    - name: title
      label: Title
      type: text
    - name: description
      label: Description
      type: text
```

```svelte
{#each features || [] as feature}
  <h3>{feature.title}</h3>
{/each}
```

## group

Nested object of fields.

```yaml
- name: author
  label: Author
  type: group
  subfields:
    - name: name
      label: Name
      type: text
    - name: avatar
      label: Avatar
      type: image
```

```svelte
<div>{author?.name}</div>
{#if author?.avatar?.url}
  <img src={author.avatar.url} alt={author.avatar.alt} />
{/if}
```

## page

Reference to one page of a configured page type. The component receives that page's fields plus `_meta`.

```yaml
- name: featured_post
  label: Featured Post
  type: page
  config:
    page_type: blog-post
```

```svelte
{#if featured_post?._meta?.url}
  <a href={featured_post._meta.url}>{featured_post._meta.name}</a>
{/if}
```

## page-list

All pages of a configured page type. Component value is an array of page data objects.

```yaml
- name: posts
  label: Posts
  type: page-list
  config:
    page_type: blog-post
```

## page-field

Reference a page-level field defined on a page type. Set `config.field` to `<page-type-folder>--<field-key>`: the page type's folder under `page-types/`, two dashes, then the field's `name` in that type's `fields.yaml`.

```yaml
- name: hero_image
  label: Hero Image
  type: page-field
  config:
    field: blog-post--hero_image
```

A bare field key (`field: hero_image`) only resolves when exactly one page type has that field, and import warns about it; use the compound form so the reference stays unambiguous when the block is reused across page types.

## site-field

Reference a site-wide field. Set `config.field` to the site field name.

```yaml
- name: phone_number
  label: Phone Number
  type: site-field
  config:
    field: phone_number
```

## slider

Range slider for numeric values.

```yaml
- name: opacity
  label: Opacity
  type: slider
  config:
    min: 0
    max: 100
    step: 10
```

## date

Date picker. Component value is a date string, usually `YYYY-MM-DD`.

```svelte
<time datetime={published_at}>{published_at}</time>
```

## info

Display-only markdown for editors. It is not passed to the component as rendered content.

```yaml
- name: editing_note
  type: info
  config:
    info: Use this block only at the top of landing pages.
```
