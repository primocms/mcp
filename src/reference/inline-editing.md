# Inline Editing (`data-key`)

The editor enables on-page editing (click a heading to change its text, click a link to change its URL/label) by matching rendered DOM elements back to their fields. Automatic matching is fragile: it fails when text has fallbacks, anchors wrap icons, or multiple elements share the same value.

Always add `data-key="<field_name>"` on the element bound to a field. This makes the binding explicit and keeps the field editable in the CMS.

```svelte
<h1 data-key="headline">{headline}</h1>
<p data-key="subheadline">{subheadline}</p>

<!-- link fields: put data-key on the <a> -->
<a href={cta.url} data-key="cta">
  {cta.label || 'Get Started'}
  <svg>...</svg>
</a>

<!-- image fields: put data-key on the <img> -->
<img src={hero_image.url} alt={hero_image.alt} data-key="hero_image" />

<!-- repeater items: use the subfield name scoped to each item -->
{#each features as feature}
  <div>
    <h3 data-key="title">{feature.title}</h3>
    <p data-key="description">{feature.description}</p>
  </div>
{/each}
```

## Rules

- Add `data-key` to every element bound to a text, rich-text, markdown, link, image, icon, url, or number field.
- For links and images, put `data-key` on the `<a>` / `<img>` itself, not a wrapping div.
- For group/repeater subfields, `data-key` uses the subfield name, such as `data-key="title"`, not a dotted path.
- An element without `data-key` may still be editable if its rendered text exactly matches the field value with no child content; do not rely on that.

## Practical Guidance

Use `data-key` even when the field appears obvious in markup. The editor cannot reliably infer intent from rendered DOM after fallbacks, conditionals, child elements, icons, or duplicate text values are involved.

For link fields, the editable field is the link object, so the key belongs on the anchor:

```svelte
<a href={cta?.url || '#'} data-key="cta">
  {cta?.label || 'Learn More'}
</a>
```

For image fields, the editable field is the image object, so the key belongs on the image:

```svelte
{#if hero_image?.url}
  <img src={hero_image.url} alt={hero_image.alt} data-key="hero_image" />
{/if}
```

For repeaters and groups, keys are scoped to the current item or group in the editor. Use the subfield's local name:

```svelte
{#each features || [] as feature}
  <article>
    <h3 data-key="title">{feature.title}</h3>
    <p data-key="description">{feature.description}</p>
  </article>
{/each}
```
