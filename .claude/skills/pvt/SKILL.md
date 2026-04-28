---
name: pvt
description: >
  Production Validation Testing (PVT) — quick sanity check immediately after a release.
  Runs Mermaid only on production to confirm the app is live and the new version is rendering.
  Not a full smoke test — CI already handles that. Use after /release-app completes.
  Triggers on "pvt", "production validation", "validate release", "validate production".
---

# Production Validation Testing (PVT)

Quick post-release spot-check. Confirms the app is live and the most-used diagram type renders correctly on production.

## Why PVT and not smoke test

The CI pipeline runs an automated smoke test (all macros) after every release. PVT is the human-executed complement — one macro, one site, immediate confirmation that the new version actually landed. Full regression runs in staging before release; CI smoke runs after; PVT is the manual "is it alive?" check.

Mermaid is used because it exercises the core render pipeline and is the most-used diagram type.

## Arguments

Usage: `/pvt [lite] [full] [diagramly]`

- If no variant specified, run all three.
- Macro: always Mermaid.
- Site: always production — never staging.

| Variant | Production site |
|---------|----------------|
| lite | zenuml.atlassian.net |
| full | zenuml.atlassian.net |
| diagramly | zenuml.atlassian.net |

## Steps

For each requested variant, invoke the smoke-test skill with the production site and mermaid macro:

- **Lite**: `/smoke-test on zenuml lite mermaid`
- **Full**: `/smoke-test on zenuml full mermaid`
- **Diagramly**: `/smoke-test on zenuml diagramly mermaid`

Run variants sequentially. If a variant fails, report it and continue with the remaining variants.

## Report

After all variants complete:
- Pass/fail per variant
- Version string visible in the macro toolbar (confirms the new release is live, not the previous one)
- Any errors encountered
