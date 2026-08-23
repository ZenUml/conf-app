# Paywall extension questionnaire — three-question redesign

**Date:** 2026-08-23
**Base:** `feat/paywall-expiry-paid-closure`
**Decision source:** Fable 5 questionnaire review, approved by the user with `implement it`

## Objective

Reduce the extension intake from five mandatory research-heavy steps to two mandatory operational
questions and one optional product-research question. The flow must restore eligible users to work
quickly, explain that answers do not decide eligibility, and keep research answers out of the
administrator notification.

## Final questionnaire

### Disclosure

> If this is your first eligible request, your 7-day access starts as soon as you submit. Your
> answers do not affect whether you qualify.
>
> ZenUML may notify your organisation's registered technical or site contact. That message contains
> only this Space, its approximate diagram count, and the scope and timing you select below. Your
> optional product-research answer is not shared with your organisation.

The copy must not describe the research as anonymous because request answers remain associated with
operational request, account, tenant, and Space identifiers in D1.

### Question 1 — required scope

> **What access does your team need beyond these 7 days?**

- `self` — Just me, in this Space
- `space` — Several people in this Space
- `site` — Multiple Spaces across our site
- `not_sure` — Not sure yet

Help text:

> This helps us suggest the right long-term option to your admin. Your own 7-day access is the same
> whichever you pick.

### Question 2 — required urgency

> **When do you need this diagram work done?**

- `today` — Today
- `this_week` — This week
- `no_hard_deadline` — No hard deadline

Help text:

> Included in the admin message so they can prioritise.

### Question 3 — optional AI-diagram use

> **Optional: do you use AI tools to create or edit diagrams?**

- `regularly` — Yes, regularly
- `occasionally` — Yes, occasionally
- `interested` — No, but I'd like to
- `no` — No

Help text:

> Product research only. Never shared with your organisation.

The final step has an obvious `Skip` action and `Start my 7 days` CTA. Skipping stores no inferred AI
answer. Scope and urgency remain required. The first grant is unchanged: authenticated requester plus
current Space for exactly seven days.

## Removed questions and data

Remove current task, diagram audience, named AI-tool selection, diagram-format selection, required
process/template, and cloud-AI policy from the production form. The new client must not fabricate
placeholder answers for removed fields. Existing stored version-one answers remain valid historical
records and are not rewritten.

## API and rollout contract

The new client sends `questionnaireVersion: 2` and:

```ts
answers: {
  unblockNeed: {
    scope: 'self' | 'space' | 'site' | 'not_sure';
    urgency: 'today' | 'this_week' | 'no_hard_deadline';
  };
  aiDiagramUse?: 'regularly' | 'occasionally' | 'interested' | 'no';
}
```

The backend accepts both the existing version-one payload and version two during the rollout so old
Forge frontends continue to work after the Pages backend updates. Version-one urgency
`planning_ahead` renders as `without a hard deadline` in operational email copy. Deployment order is
backend before the new Forge frontend; the new frontend does not send fabricated version-one fields
to an old backend.

The D1 request table stores the coded answers in constrained columns, rather than in one JSON
column. A data-preserving migration must therefore add the questionnaire version and optional
version-two AI answer, make version-one-only columns nullable, and widen the scope and urgency
checks. Existing rows, indexes, uniqueness constraints, and notification foreign keys must remain
valid after the migration.

## Administrator-message boundary

Allowed: Space, approximate macro count, scope, urgency, grant start/end, price and CTA.
Forbidden: optional AI-diagram answer and all historical task/audience/tool/workflow/policy answers.

`not_sure` scope must produce neutral copy rather than implying a site-wide request. The new urgency
must display `without a hard deadline`.

## Analytics contract

Reuse the existing event vocabulary. Before behavior changes, extend typed properties for:

- `questionnaire_version: 2`;
- question IDs `long_term_access`, `urgency`, and `ai_diagram_use` while retaining legacy IDs;
- coded `ai_diagram_use`;
- `answer_skipped`, `time_on_step_ms`, and `option_position` for quality/abandonment analysis.

No raw text, email, account/site identifier, or contact data enters Mixpanel. The optional answer is
tracked only when selected; skip is an explicit coded outcome.

## Verification

Automated tests must prove:

1. exactly three UI questions, with only the first two required;
2. the disclosure does not imply answers decide the grant and does not claim anonymity;
3. Skip submits without an AI answer;
4. version-two parsing accepts valid coded answers and rejects invalid enums;
5. version-one payloads remain accepted during rollout;
6. administrator email handles `not_sure` and `no_hard_deadline` and cannot receive AI research;
7. grant, replay, repeat/manual review, exact expiry, authoritative macro-count and paid-precedence
   behavior remain unchanged;
8. Storybook and production intake show the three-question flow at desktop and narrow widths.

Run targeted tests, the full unit suite, Lite build and Storybook build. A main-agent browser
snapshot/screenshot is required before claiming the visible questionnaire passed.

## Out of scope

This redesign does not configure Resend/DNS/secrets, deliver reminders, change the seven-day grant,
alter contact classification, implement paid checkout, merge, or deploy production.
