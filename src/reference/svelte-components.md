# Svelte Components

Primo block components use Svelte 5.

If the official Svelte MCP server (`mcp__svelte__*`) is available, prefer it for syntax validation and rune questions — call `mcp__svelte__svelte-autofixer` after edits to a `.svelte` file.

## Syntax

- Use `$state()` for reactive variables.
- Use `$derived()` for computed values.
- Use `$effect()` for side effects.
- Use `onclick={handler}`, not `on:click={handler}`.
- Field props are auto-injected from `fields.yaml`; do not redeclare them with `$props()`.

```svelte
<script>
  let count = $state(0)
  let doubled = $derived(count * 2)
</script>

<button onclick={() => count += 1}>
  Count {count}, doubled {doubled}
</button>
```

## Editor Context

Check whether a component is running inside the CMS editor before using behavior that can interfere with editing.

```svelte
<script>
  let is_editor = $state(false)

  if (typeof window !== 'undefined') {
    is_editor = window.__PRIMO_CONTEXT__?.environment === 'editor'
  }
</script>
```

Use editor context to disable fixed or sticky positioning, skip expensive scroll and resize listeners, or show placeholder content.

## Safe Field Access

Always handle potentially undefined fields.

```svelte
{#if hero_image?.url}
  <img src={hero_image.url} alt={hero_image.alt} />
{/if}

<a href={cta?.url || '#'}>{cta?.label || 'Learn More'}</a>

{#each features || [] as feature}
  <div>{feature.title}</div>
{/each}
```
