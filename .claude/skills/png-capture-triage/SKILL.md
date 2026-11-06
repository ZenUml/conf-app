---
name: png-capture-triage
description: >
  Classify viewer PNG-capture failures (Mixpanel `convert_to_png` with event_label `toPng_failed` /
  `toPng_timeout`) per macro by cause — orphan/404 load, external icons blocked by CSP, math not
  ready, timeout — from each macro's event chain plus its D1 content. Use when a site shows
  toPng_failed, a customer reports missing PDF/PNG output, or before claiming a capture fix worked.
  Triggers on "toPng_failed", "PNG capture failing", "why no PNG attachment", "convert_to_png errors",
  "PNG 导出失败", "截图失败".
---

# PNG capture triage

Read-only. Mixpanel through the [mixpanel](../mixpanel/SKILL.md) skill's `mp_query.py`; D1 content through
[graph-content-scan](../graph-content-scan/SKILL.md).

```bash
python3 .claude/skills/png-capture-triage/scripts/triage.py \
  --site <client_domain> --from 2026-10-29 --to 2026-11-06 \
  [--split-at <release publishedAt>] [--no-scan] [--window-s 15] [--json out.json] [--keep-raw DIR]
```

Run it from the main checkout or a worktree (mp_query reads `.env.mixpanel` from the conf-app root).
It prints, per failing macro: failures, sampled successes and uploads, first/last failure, failing
users and app versions, before/after counts when `--split-at` is given, the category, and the
evidence that set it. The summary counts macros and failures per category.

## When the capture runs at all

`createAttachmentIfContentChanged` (`src/model/Attachment.ts`) captures only when the page
attachment is **missing** or its comment differs from `metaKey` = `<md5>|<diagramType>|itxt:v1`.
A view of a diagram whose attachment is current emits **no** `convert_to_png` event. Therefore:

- **Zero failures is not proof of health.** Count capture attempts: `toPng` successes plus
  `upload_attachment` / `attachment_upload_succeeded`. No attempts after a release = unproven.
- `toPng`, `upload_attachment` and `attachment_upload_succeeded` are **sampled**: 10% by
  default (`EVENT_SAMPLE_RATES` in `src/utils/analytics/eventSampling.ts`), lower during an
  event-budget window. Each kept event carries its own `sample_rate`; weight every success by
  `1 / sample_rate` rather than a fixed × 10. Error-category events (`toPng_failed`,
  `toPng_timeout`) are never sampled (`src/utils/window.ts`).

## Categories

| Category | How the script decides | Seen as |
|---|---|---|
| `orphan_404` | within 15 s before the failure: `load_custom_content_v2_missing`, `customcontent_orphan_observed` or `load_failed_shown` (event `view`, label `load_failed_shown`) | load fails, error card shown, then capture of the error card fails 5–11 s later |
| `math_not_ready` | preceding `graph_math_not_ready` (label on `create_attachment`) | MathJax not ready at capture |
| `timeout` | event_label `toPng_timeout` | capture exceeded its timer |
| `external_icons` | `capture_failure_stage=external_icons` (builds with #1061) | icon proxy failed |
| `stage:<x>` | other `capture_failure_stage` (`dom_to_svg`, `inline_images`, `svg_load`, `canvas`, `unknown`) plus `capture_error` | read the stage |
| `external_icons_suspected` | no chain explanation, and D1 content has `img/lib`, `icons.diagrams.net` or other external images | older builds pointed `img/lib` at `app.diagrams.net`, which Forge CSP blocks |
| `math_suspected` | no chain explanation, D1 content has `math="1"` | — |
| `unexplained` | none of the above, or no D1 row | open the page or read a replay |

`orphan_404` note: the viewer still calls `afterLoad` (capture) after a load error
(`viewerBootstrap.ts` calls `options.afterLoad?.(doc)` even when `loadError` is set). Suspected
bug, not verified by a test; do not report it as fact.

## Confirming a suspected category

`*_suspected` is content-based inference. To confirm external icons, read the user's session
replay with [replay-forensics](../replay-forensics/SKILL.md): a burst of `TypeError: Failed to
fetch` for `app.diagrams.net/img/lib/…` / `icons.diagrams.net` on the same second as each
`toPng_failed`. Mixpanel replays record only console output, so a browser CSP-violation line never
appears; `Failed to fetch` alone does not separate CSP from CORS or network failure. Also check the
manifest of the build the user ran (`app_version`) for the host in `permissions.external`.

## After a fix ships

Use `--split-at <publishedAt>` (`gh release view <tag> --json publishedAt`) here for the per-macro
view, and the release-app skill's `scripts/effect_check.py` for the before/after verdict.

Keep outputs (macro UUIDs, distinct ids, site names) in the scratchpad or `private/`; never in public files.
