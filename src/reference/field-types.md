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

Image upload or external image. Component value is `{ url, alt, width, height }`.

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

Optional image config:

```yaml
config:
  maxSizeMB: 1
  maxWidthOrHeight: 1920
```

## link

URL or internal page link with a label. Component value is `{ url, label, text }`; exported source may also contain `page` for internal page references.

```yaml
cta:
  url: /contact
  label: Contact us
```

```svelte
{#if cta?.url}
  <a href={cta.url} data-key="cta">{cta.label}</a>
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

Reference a page-level field defined on the current page type. Set `config.field` to the page-type field name.

```yaml
- name: hero_image
  label: Hero Image
  type: page-field
  config:
    field: hero_image
```

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
