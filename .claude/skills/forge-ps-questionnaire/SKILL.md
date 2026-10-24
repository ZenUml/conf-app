---
name: forge-ps-questionnaire
description: >
  Fill, correct, submit, and audit an Atlassian Marketplace Privacy & Security
  questionnaire ("Edit responses") for the ZenUML apps (lite / full / diagramly /
  asyncapi), and verify the result via the Marketplace REST API. Use when updating or
  correcting a P&S declaration, when a customer security review exposes P&S answers that
  don't match actual data practices, when the same answers must be replicated across
  variants, or when auditing what each app currently declares. Encodes the field-name
  map, the native-setter-vs-keystroke rule (the sub-processor entity block needs real
  keystrokes or submit fails validation), the document.body screenshot workaround,
  per-variant deltas (asyncapi omits PlantUML), and REST verification (formStatus
  SUBMITTED vs APPROVED). Triggers on "privacy and security questionnaire", "P&S form",
  "Edit responses", "data security declaration", "sub-processor list", "CCPA/GDPR
  questionnaire", "marketplace privacy form", "audit P&S".
---

# Forge Marketplace Privacy & Security questionnaire

Console form at `marketplace.atlassian.com/manage/apps/<appId>/privacy-and-security` →
**Edit responses**. There is **no write REST API** — edits happen only in the console
(browser). But the READ endpoint is public and is your verification backbone.

## App map

| Variant | appId | appKey | sub-processors |
|---|---|---|---|
| lite | 1219422 | `com.zenuml.confluence-addon-lite` | 5 |
| full | 1218380 | `com.zenuml.confluence-addon` | 5 |
| diagramly | 1230599 | `gptdock-confluence` | 5 |
| asyncapi | 1225068 | `my-api` | **4 — no PlantUML** (sequence macro stripped, so plantuml.com is unreachable; but AI Repair via the OpenAPI macro IS reachable → keep OpenAI/Anthropic) |

## Workflow

1. **Audit current state (read-only, no browser):**
   `scripts/verify-ps.sh <variant>` — prints every field and flags `!!` deviations from
   the canonical target. Run this FIRST to see what actually needs changing.
2. **Establish the answers.** The authoritative template is **an already-submitted
   variant's live REST JSON** (`scripts/verify-ps.sh <variant> --json`), not a hand
   draft — the owner has already reviewed those answers. Apply per-variant deltas
   (asyncapi: 4 subs + "AsyncAPI/OpenAPI specification" EUD wording instead of "diagram
   source text").
3. **Fill in the console** (browser). Delegate to a subagent and hand it
   `references/fill-mechanics.md` verbatim — that file holds the field-name map and the
   quirks that will otherwise cost hours (see "Non-negotiables" below).
4. **Submit** — click "Save and preview" → complete the flow. On the preview page, eyeball
   the fields the owner cares about (CCPA rows, sub-processors) before publishing.
5. **Verify it landed:** re-run `scripts/verify-ps.sh <variant>`. `formStatus` must flip
   to `SUBMITTED`; if it still shows `APPROVED` with old values, the submission did NOT
   land — say so, don't claim success.

## Non-negotiables (each was a real, expensive failure)

- **The sub-processor entity subform accepts ONLY real keystrokes** (`browser_type`,
  `slowly:true`). Programmatic values pass the DOM but fail "mandatory field" on submit.
  Everything else takes programmatic `browser_evaluate` writes. See fill-mechanics.md.
- **One unsaved form at a time.** Any navigation/reload/relay-drop discards the whole
  unsaved form. Do not open a second app's form (or run a PVT, or any other browser task)
  while an unsaved P&S form is in play. Finish → submit → then the next.
- **Verify the precondition, not a verbal state.** Before touching the browser, run
  `verify-ps.sh` to confirm whether the form is already submitted — don't act on "it's
  free" / "I submitted it" without the `formStatus` check. (Two forms' worth of work were
  lost to skipping this.)
- **Prefer fill-then-submit in one session over fill-then-stop-for-review.** Review the
  *decision* once (on the first variant); for the rest, replicating an already-approved
  submission is mechanical — leaving it unsaved for review just exposes it to loss. Only
  stop-before-submit when the owner explicitly wants to eyeball that specific form.
- **The listing JSON's `endUserLicenseAgreementUrl` is dormant/stale** — it keeps an old
  custom URL even when the app is on the Standard Agreement. Never judge the EULA from it;
  check the version's Links tab or the rendered listing page. (Mis-diagnosed 3 of 4 "EULA
  defects" from that field once.)

## Canonical target (as of the 2026-07 security-review pass)

stores/process = Yes · residency = *App does not support DR* · retention max 90, custom
disallowed · GDPR controller = No, processor = Yes (+EUD types) · CCPA business = Not
applicable, service provider = Yes (+EUD types) · disk encryption = Yes · security policy
URL = `https://app.zenuml.com/privacy-policy/privacy-policy.html` · EEA transfer = Yes +
SCC mechanism · DPA = No (until one exists). `verify-ps.sh` flags anything off this.

**Legal-judgment fields** (don't silently flip; they're the owner's call, currently
settled as above): GDPR controller No, CCPA business Not-applicable, CCPA service-provider
Yes. The processor↔service-provider and controller↔business pairs should stay mirrored
across all four variants. Mixpanel analytics is the one arguable "we're a controller" edge
— flagged, deferred to counsel.

See [references/fill-mechanics.md](references/fill-mechanics.md) for the field-name map,
native-setter/keystroke snippets, chip-list handling, and the screenshot workaround.
