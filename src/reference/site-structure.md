# Site Structure

Primo exports a site as editable source files. Agents should edit the files in place and let `primo dev` sync changes back to the local dev server.

```text
blocks/           # Svelte components with content fields
  {name}/
    config.yaml     # _id (system-stamped) + display name
    fields.yaml     # bare list of field definitions
    content.yaml    # block defaults: sidebar values + seed for new sections (required)
    component.svelte
page-types/       # Page templates
  {name}/
    config.yaml     # _id, name, icon, color, allowed_blocks
    fields.yaml     # bare list of page-level field definitions (e.g. seo_title)
    layout.yaml     # header/body/footer sections (required; comment-only stub when unused)
    head.svelte     # Optional per-page-type head markup (per-page SEO) — see head-and-seo.md
pages/            # Page content
  index.yaml      # Homepage
  contact.yaml    # Leaf page (/contact)
  about/
    index.yaml    # /about
    team.yaml     # /about/team
site/             # Site-wide settings
  fields.yaml     # bare list of site-wide field definitions
  content.yaml
  head.svelte     # Optional head markup; no <svelte:head> wrapper
  foot.html       # Optional markup injected before the closing body
uploads/          # Image binaries — drop files here and reference from yaml
.primo/           # Internal metadata — do not edit, do not commit
```

## Multi-site workspaces

A workspace (marketplace export) holds many sites: `server.yaml` at the root, one site per folder under `sites/`, an optional shared `library/`, and the workspace database in a root `.primo/`. Each `sites/<name>/` folder has the single-site layout above plus a `site.yaml` (display name + `site_id`).

Creating a folder under `sites/` is **not** enough to make the site exist — its records must be registered into the workspace database:

- `primo new <name>` scaffolds a starter site and registers it.
- `primo add <name>` registers an existing hand-authored folder: it mints the `site_id` into `site.yaml` if missing and imports the site's records, picking it up live if `primo dev` is already running. Run it from the workspace root.

Never register a site by cd-ing into its folder and running `primo dev` there — that creates a separate nested database instead of registering into the workspace.

The `uploads/` folder is a real input directory. Drop image files in it and reference them from any image field with `upload: uploads/<filename>` — on push, the server creates a `site_uploads` record, stores the binary, and rewrites the yaml to use the record ID. See `field-types.md` (`image`) for the exact yaml shape. After first push, the local file is renamed to its canonical (suffixed) form so subsequent pulls/pushes round-trip without churn.

## One folder shape, two file roles

Both `blocks/` and `page-types/` use the same folder shape:

- `config.yaml` — stable identity (`_id`) and editor metadata (display name; for page types also `icon`, `color`, `allowed_blocks`).
- `fields.yaml` — a **bare top-level list** of field definitions. Same shape across blocks, page types, and `site/fields.yaml`. Never wrapped in `fields:` or anything else.

Folder names are the stable reference key (page sections use `block: <key>`, page types use `allowed_blocks: [<key>, ...]`). Editing `name` in `config.yaml` only changes the editor display label — it does **not** rename the folder or update references.

Page types additionally have `layout.yaml`, which defines the type's `header`, `body`, and `footer` sections. `header`/`footer` render on every page of the type; `body` seeds the default sections copied onto each newly created page (see content-model.md for the seed-only semantics). It's required even when nothing is wired up; in that case it ships as a comment-only stub that documents the schema. To wire sections up, uncomment the example and reference a block by folder name:

```yaml
header:
  - block: site-header
body:
  - block: hero
footer:
  - block: site-footer
```

## Head and Foot

`site/head.svelte` is injected into Primo's generated `<svelte:head>` on every page, followed by the current page type's `head.svelte`. Do not wrap either in `<svelte:head>`. Use direct head children such as `<meta>`, `<link>`, `<script>`, and `<style>`; put `<title>` in the page-type head, not the site head. `site/foot.html` is static HTML injected before `</body>`.

See `head-and-seo.md` for how the head is assembled, what data is in scope, and the per-page SEO pattern.

## System IDs

Blocks, fields, pages, page types, and sections all have system-owned `_id` values.

- For blocks, `_id` lives in `blocks/<key>/config.yaml`.
- For page types, `_id` lives in `page-types/<key>/config.yaml`.
- For pages and sections, `_id` is at the top of the page YAML.
- For fields, `_id` is on each field entry inside `fields.yaml`.
- When creating a new entity, omit the ID. The dev server generates one and writes it back on first sync.
- Do not invent or hand-author new IDs.
- Keep existing IDs stable when editing an entity.
- Duplicate IDs are conflicts and may cause affected files to be skipped.

## Workflow

1. Run `primo dev` to start the local preview server. It watches the site export folder and auto-imports file changes into the running CMS.
2. Edit blocks, pages, page types, or site settings.
3. Let `primo dev` sync changes — it reports each import and triggers a browser reload.
4. Call the `build_preview` MCP tool to regenerate the published preview, then load the returned site URL to verify visually.
5. Run `primo push` to deploy changes to a live server when connected.
