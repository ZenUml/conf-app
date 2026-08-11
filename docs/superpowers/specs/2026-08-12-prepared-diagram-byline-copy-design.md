# Prepared diagram byline copy

**Date:** 2026-08-12  
**Status:** Approved copy design; implementation pending

## User job

While reading a dense Confluence page, a user wants to understand one relevant process, system, or idea quickly. The diagram may explain only part of the page. The byline must not imply that the whole page will be transformed, and it must not foreground whether the diagram was prepared earlier.

## Copy system

The byline uses a dynamic, topic-specific object label when a trustworthy short topic is available:

```text
{short topic} diagram
```

Examples:

- `Release process diagram`
- `Auth flow diagram`

The complete byline title must be at most 30 Unicode code points. The short topic is a sentence-case noun phrase with no trailing punctuation and no redundant `diagram` suffix. The preparation pipeline requests a short topic that fits the limit.

If no trustworthy short topic fits, the byline title falls back to:

```text
Explore visually
```

Do not truncate a topic or show an ellipsis. The fallback changes only the byline title; it does not discard the full topic.

The tooltip always carries the complete topic using the outcome-oriented JTBD pattern:

```text
Understand {full topic} at a glance
```

For example:

```text
Understand the release process across staging and production at a glance
```

A prepared diagram without a usable full topic must not publish the byline property, because it cannot satisfy the tooltip contract.

## AI signalling

Keep the existing purple sparkle-and-diagram icon. It conveys AI-assisted visualization without adding `AI` to the title. A bot icon is not used because it would suggest a chat experience.

The icon remains static. Only the title and tooltip vary by page.

## Forge delivery

Use the existing `zenuml-prepared-diagram` Confluence content property as the byline's `contentPropertyKey`. Forge can read `title`, `icon`, and `tooltip` from this property on initial render; this design supplies dynamic `title` and `tooltip` while retaining the manifest's static icon.

The prepared-diagram publisher writes the derived copy with the visibility marker, for example:

```json
{
  "v": 2,
  "title": "Release process diagram",
  "tooltip": "Understand the release process across staging and production at a glance"
}
```

The manifest keeps `entityPropertyExists` on the same property so the byline is visible only for prepared pages. It also declares:

```yaml
contentPropertyKey: zenuml-prepared-diagram
```

Do not use `dynamicProperties`: it would add a Forge function invocation to the render path, while the content property already contains all display data.

## Validation and fallback

Before publishing the content property:

1. Require a non-empty full topic suitable for the tooltip sentence.
2. Normalize the optional short topic and append ` diagram` exactly once.
3. Use the topic-specific title only when the resulting title is at most 30 Unicode characters.
4. Otherwise use `Explore visually`.
5. Always retain the full-topic tooltip.

Existing `{ v: 1 }` properties have no dynamic copy. Do not assume how Forge renders a `contentPropertyKey` object with missing display fields: rewrite all pilot properties to the new shape before enabling the manifest field, and keep one legacy property as a staging control. The staging spot check must establish whether missing fields fall back to the manifest defaults or require explicit migration handling.

## Analytics and privacy

Do not send topic text, generated titles, tooltips, page titles, or diagram source to Mixpanel. They may contain customer-sensitive content.

Do not add a rendered/impression event: the byline is Confluence-rendered chrome and the app has no trustworthy render hook. Attach the copy result to the existing `activation_served` event after a click successfully loads the prepared payload. Add only non-content properties needed to evaluate the copy behavior:

- `byline_label_variant`: `topic_diagram` or `explore_visually`.
- `byline_label_fallback_reason`: `missing_short_topic`, `too_long`, or `invalid`; absent for `topic_diagram`.
- `label_length_bucket`: `1_15`, `16_23`, `24_30`, or `fallback`, rather than the literal title.

Register these properties in `src/utils/analytics/types.ts` before implementation. The existing `activation_nudge_clicked` → `activation_served` → completion funnel remains unchanged; the label signal must not be presented as proof that the user understood the diagram.

## Acceptance criteria

- A prepared diagram with short topic `Release process` renders `Release process diagram`.
- A short title over 30 Unicode characters renders `Explore visually`, without ellipsis.
- Both cases expose the full-topic tooltip in the `Understand … at a glance` form.
- The existing sparkle-and-diagram icon remains visible.
- Pages without the prepared-diagram content property show no activation byline.
- All pilot properties are rewritten before rollout; a staging control establishes and documents Forge's behavior for legacy property values.
- Analytics contain no raw topic or page content.
