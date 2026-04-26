# Blocks

Each block is a folder in `blocks/` with a Svelte component and field definitions.

```text
blocks/hero/
  component.svelte
  fields.yaml
  content.yaml
```

## component.svelte

Props are auto-injected from `fields.yaml`. Do not declare `$props()` for Primo field props; use the field names directly in the template.

```svelte
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

`fields.yaml` declares the editable props for the block.

```yaml
name: Hero
fields:
  - name: headline
    label: Headline
    type: text
  - name: image
    label: Image
    type: image
```

Field IDs are optional. Keep existing `_id` values when editing existing fields, but omit `_id` on new fields.

## content.yaml

`content.yaml` stores block defaults only. It supplies values shown in the block editor sidebar and seeds the initial `content:` when the block is first added to a page.

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
name: Feature Grid
fields:
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
