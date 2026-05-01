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
  - hero
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

If `allowed_blocks` is omitted or empty, the page type is treated as static: the editor offers no blocks for new sections. This is valid and should not be treated as a schema error. Use static page types only when the layout is fully defined by `layout.yaml`.

## Shared Layout

`page-types/{name}/layout.yaml` can define shared `header` and `footer` sections that render on every page of the type. Do not duplicate those sections in individual `pages/*.yaml` files.

```yaml
header:
  - block: nav
    content:
      logo:
        url: /logo.svg
        alt: Site logo
footer:
  - block: footer
    content:
      copyright: Copyright 2026
```

## Page Fields

Page fields are content that belongs to the page, not to a block. Common uses are SEO title, SEO description, hero image, post date, author, and featured flags.

- Define page fields once in `page-types/{name}/fields.yaml`.
- Populate them per page via the top-level `fields:` key in `pages/*.yaml`.
- Read them in a block with a `page-field` field whose `config.field` points to the page field name.

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
    field: hero_image
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
