---
name: bug-report-framing
description: Structure a conf-app bug report or incident write-up with User-First Trace — user journey first, then runtime evidence, then code path. Use when writing up a customer-reported bug, a production incident, a regression report, or a postmortem for the ZenUML Confluence app. Triggers on "write up this bug", "incident report", "bug report", "postmortem", "how should I frame this issue".
---

# Bug reports: User-First Trace

Frame bug reports and incident write-ups with **User-First Trace**:

1. **User journey** — start with what the user did, what they saw, what changed, and what outcome they experienced. Keep the end user as the skeleton of the report and the highest priority.
2. **Runtime evidence** — layer in console errors, network calls, API responses, analytics events, timing, retries, page/draft state, and environment details.
3. **Code path** — only after the user journey and runtime evidence are clear, explain the source code paths that produced the behavior.

## State-Surface Framing

Use lower-level techniques such as State-Surface Framing inside this structure when relevant: identify where the data truth lives (published page, draft page, macro config, custom content, D1 mirror) and which UI/runtime surface is reading or writing it (page viewer, viewer modal, native macro config, page editor, fullscreen modal).
