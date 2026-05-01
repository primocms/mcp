# Blocks

Each block is a folder in `blocks/` with four files:

```text
blocks/hero/
  config.yaml      # _id (system-stamped) + display name
  fields.yaml      # bare list of field definitions
  content.yaml     # default values shown in the editor sidebar (required)
  component.svelte
```

The folder name (`hero` here) is the block's stable key — it's what `pages/*.yaml` sections and page-type `allowed_blocks` reference. Renaming the folder breaks references; editing `name` in `config.yaml` only changes the display label in the editor.

## config.yaml

Holds the system-stamped `_id` and the human-readable name shown in the editor sidebar.

```yaml
_id: 8a1q3pf2nv0xkrm
name: Hero
```

`_id` is generated and written back by the dev server on first sync. Omit it when scaffolding a new block; keep it stable thereafter.

## component.svelte

Declare the block's editable fields with Svelte 5 `$props()` so runtime data is available to the template.

```svelte
<script>
  let { headline = '', image = {} } = $props()
</script>

<h1 data-key="headline">{headline}</h1>

{#if image?.url}
  <img src={image.url} alt={image.alt} data-key="image" />
{/if}

<style>
  h1 {
    font-size: 2rem;
  }
</style>
```

## fields.yaml

A **bare top-level list** of field definitions — no wrapper object.

```yaml
- name: headline
  label: Headline
  type: text
- name: image
  label: Image
  type: image
```

Field IDs (`_id`) are optional. Keep existing `_id` values when editing existing fields, but omit `_id` on new fields.

## content.yaml

`content.yaml` stores block defaults. It supplies the values shown in the block editor sidebar preview, and seeds the initial `content:` when the block is first added to a page. **It's required for every block** — without it, the editor sidebar shows empty/broken previews. If there are no defaults yet, write `{}`.

```yaml
headline: A better way to build
image:
  url: https://example.com/hero.jpg
  alt: Hero image
```

`content.yaml` does not cascade. Once a section exists in `pages/*.yaml`, that section's `content:` is the source of truth. Editing the block's `content.yaml` afterward changes nothing about that section.

## Nested Fields

Use `subfields` for `group` and `repeater` fields.

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
  <article>
    <h3 data-key="title">{feature.title}</h3>
    <p data-key="description">{feature.description}</p>
  </article>
{/each}
```
