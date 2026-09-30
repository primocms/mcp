# Content Model

Rendered page content comes from the section `content:` in `pages/*.yaml`, not from a block's `content.yaml`.

## Content Cascade

- `blocks/{name}/content.yaml` stores block-level defaults.
- Defaults are used for (1) values shown in the block editor sidebar and (2) the initial `content:` seeded when the block is first added to a page.
- Defaults do not cascade. Once a section exists on a page, that section reads from its own `content:` in `pages/*.yaml`.
- Editing a block's `content.yaml` afterward changes nothing about existing page sections.
- To add or change content on an existing page, edit the section's `content:` in `pages/*.yaml`, not the block's `content.yaml`.

## Page Types

`page-types/{name}/config.yaml` defines page-type metadata and block availability.

```yaml
_id: pt_blog_post
name: Blog Post
icon: lucide:file-text
color: '#2563eb'
allowed_blocks:
  - body
```

Page-level field definitions live in `page-types/{name}/fields.yaml` as a bare list:

```yaml
- name: title
  label: Title
  type: text
- name: hero_image
  label: Hero Image
  type: image
- name: published_at
  label: Published
  type: date
```

`allowed_blocks` is the list of block folder names offered by the editor's add-block picker for pages of this type.

Include a block only when editors should be able to add another instance to the page body. Shared Navigation/Footer and once-per-page heroes normally stay out of this list; they can still be referenced by layouts or pages. See `recommended-defaults` for field-scope and page-type design guidance.

If `allowed_blocks` is omitted or empty, the page type is treated as static: the editor offers no blocks for new sections, and the `body:` sections in `layout.yaml` are locked (editors cannot add, remove, or reorder them). This is valid and should not be treated as a schema error.

## Shared Layout

`page-types/{name}/layout.yaml` defines a page type's `header`, `body`, and `footer` sections.

- `header` / `footer` — shared sections that render on every page of the type. Do not duplicate them in individual `pages/*.yaml` files.
- `body` — **seed defaults** for the page body. When a new page of this type is created, the editor copies these onto the page's own sections. If `allowed_blocks` is non-empty (dynamic), editors can then modify them per page; if `allowed_blocks` is empty (static), they are locked.

`body` is seed-only: it never alters pages that already exist, and the renderer sources a page's body from that page's own `sections:`, not from `layout.yaml`. Editing `body:` after pages exist only affects pages created afterward. That includes page files you write yourself: a hand-authored `pages/*.yaml` with `sections: []` renders with no body. List the sections it should have in its own `sections:`. A `body` block may reference a block that is not in `allowed_blocks` (e.g. a one-off hero) — that is allowed.

```yaml
header:
  - block: nav
    content:
      logo:
        url: /logo.svg
        alt: Site logo
body:
  - block: hero
    content:
      heading: Welcome
footer:
  - block: footer
    content:
      copyright: Copyright 2026
```

## Page Fields

Page fields are content that belongs to the page, not to a block. Common uses are SEO title, SEO description, hero image, post date, author, and featured flags.

- Define page fields once in `page-types/{name}/fields.yaml`.
- Populate them per page via the top-level `fields:` key in `pages/*.yaml`.
- Read them in a block with a `page-field` field whose `config.field` is `<page-type-folder>--<field-key>` (e.g. `blog-post--hero_image`).

```yaml
# pages/blog/first-post.yaml
_id: existing_page_id
name: First Post
page_type: blog-post
fields:
  title: A Quiet Cut
  hero_image:
    url: https://example.com/hero.jpg
    alt: Barber at work
  published_at: 2026-01-15
sections: []
```

```yaml
# blocks/hero/fields.yaml
- name: hero_image
  label: Hero Image (from page)
  type: page-field
  config:
    field: blog-post--hero_image
```

## Pages

Page paths come from file paths. `pages/index.yaml` is the homepage, `pages/about.yaml` is `/about`, and `pages/about/team.yaml` is `/about/team`.

On import, Primo derives the slug and parent hierarchy from the file path.

```yaml
name: About
page_type: default
fields:
  seo_title: About Us
sections:
  - block: hero
    content:
      headline: About Us
```
