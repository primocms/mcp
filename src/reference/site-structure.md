# Site Structure

Primo exports a site as editable source files. Agents should edit the files in place and let `primo dev` sync changes back to the local dev server.

```text
blocks/           # Svelte components with content fields
  {name}/
    component.svelte
    fields.yaml
    content.yaml  # Block defaults: sidebar values and seed content for new sections
page-types/       # Page templates
  {name}/
    config.yaml
    layout.yaml   # Optional shared header/footer sections
pages/            # Page content
  index.yaml      # Homepage
  contact.yaml    # Leaf page (/contact)
  about/
    index.yaml    # /about
    team.yaml     # /about/team
site/             # Site-wide settings
  fields.yaml
  content.yaml
  head.svelte     # Optional head markup; no <svelte:head> wrapper
  foot.html       # Optional markup injected before the closing body
.pala/            # Internal metadata
```

## Site Head

`site/head.svelte` is injected into Primo's generated `<svelte:head>`. Do not wrap it in `<svelte:head>`.

Use direct head children such as `<title>`, `<meta>`, `<link>`, `<script>`, and `<style>`.

## System IDs

Blocks, fields, pages, page types, and sections all have system-owned IDs. Most files use `_id`; page type configs use `id`.

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
