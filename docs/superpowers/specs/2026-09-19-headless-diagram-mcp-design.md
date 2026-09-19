# Headless Diagram MCP — creating and editing Confluence diagrams with the page closed

**Date:** 2026-09-19
**Status:** Draft (design; not yet reviewed)
**Amends:** `2026-07-08-live-agent-link-design.md` — specifically its locked decision #1 ("Actor = macro") and decision #4 ("write the bound diagram only"). The live-linked relay that design specifies is **kept**; this adds a second actor beside it.
**Relates to:** `docs/analysis/2026-08-23-agent-link-remote-mcp-auth-discussion.md` §5 and §10 — this document is that analysis's deferred OAuth decision being taken, on the trigger it named.

---

## 1. What a person does

A developer is in Claude Code with a repo open. They have never opened Confluence in this browser session.

> "Our auth flow changed — the refresh-token hop moved to the gateway. Update the sequence diagram on the *Auth architecture* page."

The agent finds the page, reads the diagram, rewrites the DSL, and writes it back. The developer opens Confluence later and the diagram is current, with one ordinary page version in the history attributed to them.

Second scenario, same session:

> "The *Payments runbook* page has no diagram. Add one showing the retry ladder."

The agent creates the diagram and appends the macro to that existing page. Nothing was open in a browser at any point.

Neither scenario works today. Both are the point of this design.

---

## 2. Why the current architecture cannot do this

The 2026-07-08 design locked **"actor = macro"**: every Confluence read and write happens inside the open Forge iframe, in the logged-in user's context, so the agent holds no Atlassian credential. That inversion is what makes the live link safe and cheap. It is also exactly what makes these two scenarios impossible — both require a privileged actor when no iframe exists.

**There is no credential in the system that survives the page being closed.** The Cloudflare backend's only Confluence auth today is the pair of per-invocation headers the Forge remote injects on each call:

- `x-forge-oauth-user` — read by `functions/forge-custom-content.ts:26`, which rejects the request outright when it is absent ("not a valid Forge request").
- `x-forge-oauth-system` — read by `functions/forge-upload-attachment.ts:419`. The rationale is written out at `functions/forge-upload-attachment.ts:27-33`: a Forge remote with `auth.appSystemToken.enabled` "gets `x-forge-oauth-system` injected on every invocation".

*On every invocation* is the operative phrase. No live Forge invocation, no token. Both headers are request-scoped and neither is storable.

Confirmed absent from the repo as of this date:

- No `webtrigger` module — `grep -rn "webtrigger" manifest.yml src/ functions/` returns nothing.
- No OAuth / 3LO / refresh-token code anywhere; the only matches for those terms are the two `x-forge-oauth-*` header reads above.

So the capability has to be built, not wired up.

---

## 3. What already exists and is reusable

Both of the hard mechanical problems are solved in this repo already. Neither needs inventing; both need porting.

### 3.1 Headless create is proven end-to-end

`.claude/skills/create-test-page/scripts/create-test-page.mjs` (222 lines) creates a page carrying working ZenUML macros in three REST calls, then reads everything back and verifies it:

1. `POST /rest/api/content` — the page.
2. `POST /rest/api/content` per macro — custom content of the right type, container = the page. The type/field mapping is the `MACROS` table at `:37`: `graph` → `zenuml-content-graph` with `graphXml`; everything else → `zenuml-content-sequence` with `code` / `mermaidCode` / `plantUmlCode`, and `diagramType` in exact `DiagramType` casing (`"OpenAPI"`, `"AsyncAPI"`).
3. `PUT /rest/api/content/{pageId}` — the page body as `atlas_doc_format` with one `extension` node per macro.

It authenticates with Basic + Atlassian API token. **The REST surface is identical under an OAuth bearer** — only the `Authorization` header changes. This script is the proof that the "create doesn't render / needs ADF macro insertion" trap flagged in the 2026-07-08 design §4.2 is solved.

### 3.2 Append-to-existing-page is production code

`src/utils/byline/addToPage.ts` (307 lines) already implements *"put this saved diagram onto that existing page"* — read ADF, check, append, publish one version. It ships in the Lite byline today.

What it gives us, and what it cost to learn, is in its semantics rather than its REST calls:

- `AddToPageResult` (`:35`) = `added | already_present | forbidden | conflict | failed`, with eight distinguishable failure reasons at `:50` (`read_forbidden`, `write_forbidden`, `unresolved_macro_key`, `page_read_failed`, `page_body_missing`, `page_body_unparsable`, `page_write_failed`, `threw`). The header explains why the granularity exists: `failed` as one bucket over six unrelated causes cannot be acted on after the fact.
- **Dedupe via `referencesCustomContent()` (`:185`)**, which delegates to `model/page/referencedCustomContent` — the same walk `AtlasPage`'s scan uses. Its comment records a real bug: a private copy that read only `customContentId` missed macros created by *pasting a deeplink*, the two checks disagreed, and a click appended a second copy of the same diagram.
- **Optimistic concurrency** (`:244`, `:261`, `:270`): read `version.number`, write `version.number + 1`, and on a second collision return `conflict` rather than retry forever. It never force-publishes over a concurrent edit.
- It appends to the end of the document and never rewrites or removes an existing node, "because nothing here knows where the author wanted it."

### 3.3 The macro node shape

`buildMacroNode()` (`addToPage.ts:140`) is modelled on a real node captured from a live page (lite-stg 260473240, 2026-09-05) rather than invented:

```js
{ type: 'extension', attrs: {
    layout: 'default',
    extensionType: 'com.atlassian.ecosystem',
    extensionKey: `${appId}/${environmentId}/static/${macroKey}`,
    parameters: {
      layout: 'extension',
      extensionId: `ari:cloud:ecosystem::extension/${appId}/${environmentId}/static/${macroKey}`,
      guestParams: { customContentId, updatedAt },
    },
    localId: <uuid>,
} }
```

Two discrepancies with `create-test-page.mjs`'s `makeExtension()` to reconcile before porting, both harmless today but not to be carried forward silently:

| | `addToPage.ts` | `create-test-page.mjs` |
|---|---|---|
| guestParams key | `customContentId` | `custom-content-id` |
| extras | none | `extensionTitle`, `text`, `forge-environment` |

**Prefer `addToPage.ts`'s form.** It is the one copied from a node Confluence itself authored, and its comment states the reasoning: the macro reads `guestParams` on render and "everything else in a Confluence-authored node is editor context it rebuilds for itself." `create-test-page.mjs`'s own verifier already accepts both spellings, so it is not evidence that the kebab form is correct.

---

## 4. Locked decisions

1. **Two actors, not one.** The macro relay stays the privileged actor while a page is open. A new headless actor handles everything else. `get_status` reports which is live.
2. **Headless credential = Atlassian OAuth 2.0 (3LO), user-consented.** Not an app-level token, not a web trigger.
3. **Writes carry the user's own permissions.** A headless write can never do something the consenting user could not do by hand. This is the property that makes decision #2 cheaper to secure than the alternatives in §8.
4. **Confluence stays the system of record.** No diagram body is ever staged, queued or parked in D1/KV awaiting a page to open (CLAUDE.md, *Content management*).
5. **Write scope widens to "any diagram the user can reach", with dedupe and conflict semantics inherited from `addToPage.ts`.** This reverses the 2026-07-08 decision #4 ("the bound diagram only"), which was a consequence of there being exactly one bound macro — an assumption that does not survive a headless actor.
6. **Never guess an `extensionKey`.** See §6.

---

## 5. Architecture

```
  Agent (Claude Code / Codex / Cursor)
        │  Remote MCP over HTTP
        ▼
  ┌──────────────── MCP endpoint (Cloudflare) ────────────────┐
  │  routes per call on whether a live session exists          │
  └───────┬───────────────────────────────┬────────────────────┘
          │ live path (existing)          │ headless path (new)
          ▼                               ▼
  AgentLinkSession DO              OAuth 3LO token store
          │ WebSocket                     │ Bearer
          ▼                               ▼
  Open Forge macro ──► Confluence ◄── Confluence REST v2
     (Forge bridge)                   api.atlassian.com/ex/confluence/{cloudId}
```

**Routing rule.** If the target diagram is bound to a live session, prefer the relay — it renders immediately in the open iframe and the user watches it happen in the activity feed. Otherwise use headless. The agent does not choose; the server does, and reports the mode it used in the tool result so the agent can explain it.

**Scopes.** `read:page:confluence`, `write:page:confluence`, `read:custom-content:confluence`, `write:custom-content:confluence`. All four are available to 3LO apps — verified 2026-09-19 against Atlassian's *Scopes for OAuth 2.0 (3LO) and Forge apps* reference, which presents them in the granular-scopes table applicable to "apps using OAuth 2.0 authorization code grants (3LO) for authorization and Forge apps", with none marked Forge-only. All four are already declared in `manifest.yml`'s `permissions.scopes`, so the Forge app asks for nothing new — but the 3LO app is a **separate registration** in the developer console and consents separately.

**Site targeting.** `GET https://api.atlassian.com/oauth/token/accessible-resources` returns the `cloudId`s the consenting user can reach. This is what replaces "the page you have open" as the way an agent knows where to write.

---

## 6. Identity resolution — the dangerous part

`resolveIdentity()` (`addToPage.ts:129`) derives `appId` and `environmentId` by parsing the **running Forge context's** `localId` against `LOCAL_ID_RE` (`:117`), and refuses to return anything unless the parsed `environmentId` agrees with the context's own. Headless has no Forge context, so this function cannot be reused as written — and it is the function standing between us and a known failure mode.

The scar tissue is recorded in `addToPage.ts:23-24`: a malformed key **rendered as an unknown extension on a customer's page** during the first live lite→full conversion (2026-08-11, job `c5a6d954`). A wrong `extensionKey` does not fail loudly; it publishes a broken macro into someone's page history.

The key is also not constant across our estate. The macro module key is `${SEQUENCE_MACRO_KEY}` in the manifest: `zenuml-sequence-macro` on lite/full, `gpt-diagram-macro` on diagramly, `zenuml-asyncapi-macro` on asyncapi — plus the `-lite` suffix on Lite. The `environmentId` differs per environment. So a headless writer serving all variants must resolve, per target site, *which of our apps is installed and in which environment*.

**Decision: resolve empirically, never construct.** Implemented in `functions/agent-link/macroIdentity.ts` (Phase 1, landed 2026-09-19).

The lever is the **custom-content type**, which turns out to carry neither an `appId` nor an environment: it is `ac:<connectKey>:<contentKey>` (`ApWrapper2.getCustomContentTypePrefix`, `src/model/ApWrapper2.ts:242`), and the connect key is a fixed per-variant constant from `package.json`'s `forge:deploy:*` scripts. There are exactly six such strings across the four variants, so a site can be *classified* before anything about it is known. For a given `cloudId`:

1. Probe each variant's custom-content types (`GET /wiki/api/v2/custom-content?type=…`). The first that returns rows fixes the **variant**, and with it the `appId` and the macro keys. A 404 means "not this variant" and is information, not a failure — only a non-404 error is `probe_failed`, because reporting a 403 as an empty site would tell a user to go insert a diagram they already have.
2. Follow up to three of those rows to their container pages, read the ADF, and lift the `<appId>/<environmentId>/static/` half of an `extension` node's `extensionKey` **verbatim**. Sampling more than one matters because orphaned custom content is a real state here (ZEN-1170) — one dead sample must not condemn the site.
3. **Cross-check** the lifted `appId` against the one the custom-content type implies. Disagreement means something is wrong with our assumptions rather than with the page, so refuse (`app_id_mismatch`). Two independent signals agreeing is the headless equivalent of `resolveIdentity`'s `localId`-vs-`environmentId` check.
4. Cache successes per `cloudId` for 30 days. **Never cache a refusal** — `no_macro_on_site` is fixed by the user inserting one diagram, and a cached no would outlive that by a month.
5. With no identifiable macro anywhere on the site, **refuse the write** and say so, telling the user to insert one diagram by hand first.

**Lift the prefix, compose the key.** The sampled node may be any macro (`zenuml-graph-macro` when the caller wants a sequence macro), so only the half we cannot derive — `appId`/`environmentId` — is lifted. The macro key is composed from the variant's own constants, mirroring `MACRO_KEY_BY_DIAGRAM_TYPE` in `addToPage.ts`. Lifting the whole string would bind every create to whichever macro type happened to be on the page we sampled.

Refusing is the correct outcome, not a gap. A site with zero ZenUML macros is a site where we cannot prove which app is installed, and the failure mode for guessing wrong is a broken macro on a customer page.

**Verified live, 2026-09-19.** Run against two staging sites, the resolver discovered `{appId, environmentId}` pairs matching the hand-maintained registry in `.claude/skills/create-test-page/scripts/create-test-page.mjs:19,27` exactly — lite staging `5ea0d957-4b7d-47e5-b8cc-7d5fb4fc2338`, diagramly staging `d9ad28ee-2933-45fc-8044-0002bc0609de`. That registry is independent of the resolver (hand-entered from `forge environments list`), so the agreement is evidence rather than a tautology.

An `update_diagram` against an existing `contentId` needs none of this — it writes custom content only and never touches page ADF. **Only creation needs an `extensionKey`,** which usefully means the risky path is the narrower one.

---

## 7. Tool surface

Port the ADF logic out of `addToPage.ts` into a module both the Vue frontend and the Worker import, so the two paths cannot drift. The frontend keeps calling it with a Forge identity; the Worker calls it with a resolved one.

| Tool | Mode | Notes |
|---|---|---|
| `list_sites()` | headless | From `accessible-resources`. New — targeting without an open page. |
| `list_spaces(cloudId)` | headless | New. |
| `list_diagrams(...)` / `search_diagrams(...)` | both | Headless variants of the existing two. |
| `read_page(pageId)` | both | |
| `read_diagram(contentId)` | both | |
| `update_diagram(contentId, dsl, summary?)` | both | Keeps the existing `updateDiagramGuard` parse + data-loss check ahead of any write, in both modes. |
| `create_diagram(pageId, type, dsl, title?)` | headless | custom content → dedupe → append node → publish one version. Returns the `AddToPageResult` union unchanged. |
| `get_status()` | both | Reports mode, bound session if any, and which sites are authorized. |

Two properties worth preserving verbatim from `addToPage.ts` because they are cheap here and expensive to retrofit: `already_present` as a first-class success (an agent that retries must not duplicate a diagram), and `conflict` rather than force-publish (an agent racing a human editor must lose).

---

## 8. Rejected alternatives

**Forge dynamic web trigger** (agent → trigger URL → Forge function → `api.asApp()`). Rejected on three independent grounds:

- CLAUDE.md's *Forge app versions — major vs minor* section lists new `dynamic` web triggers as one of only three causes of a **major** version. Major means admin re-consent on every install, rolling out only as admins approve — for all four variants.
- It runs on Forge FaaS and bills GB-seconds against the 100,000/month free tier (see the `forge-functions-cost` skill), where the current remote-on-Cloudflare path bills nothing.
- It has no user identity. Every write would run as the app, so the confused-deputy defense `forge-upload-attachment.ts:38-46` implements — verify the *calling user* can read the target before writing as the app — has nothing to verify against. Decision #3 disappears.

**Queue the write in Cloudflare; let the macro apply it when the page next opens.** Rejected: CLAUDE.md's *Content management* rule states D1/backend data "must not become required storage or recovery for user diagram bodies", and the 2026-08-23 analysis §5 rejects the same idea in the same terms — it is not actually background completion, and it makes Cloudflare the temporary store of unpublished diagram bodies.

**Store a long-lived Forge app token server-side.** Not available. Per §2 the app tokens are per-invocation headers; there is no issuance path.

**`connect(code)` pairing** (the recommendation standing before this requirement arrived, per the 2026-08-23 analysis §6). Now redundant rather than wrong: it was a cheap substitute for durable identity, and 3LO supplies durable identity as a side effect. Drop it; do not build both.

---

## 9. Safety and correctness

### 9.1 Paywall — a new bypass vector

**The Lite paywall gate is enforced in the frontend** (`src/utils/paywall/mountPaywallGate.ts:89` emits `paywall_gate_evaluated` for each gate decision). A headless `create_diagram` never loads that code, so on current plans it would create unlimited macros on an over-limit unpaid Lite space — a second, cleaner bypass on top of the fail-open leak already tracked in #302 and quantified by the `detect-bypassers` skill.

The headless writer must therefore consult the gate server-side before creating. `functions/api/space-status.ts` already returns `{ isPaid, source }`, but authenticates via `validateContextToken` (a Forge context token), so it needs a second auth path for OAuth callers. **Treat this as blocking for `create_diagram`, not as follow-up** — shipping creation before the gate ships a revenue leak.

`update_diagram` on an existing diagram is not a create and does not consume limit; it should not be gated.

### 9.2 Confused deputy

Less acute than the web-trigger option, since a 3LO write carries the user's own permissions and Confluence enforces them directly. The `forge-upload-attachment.ts` pattern still applies where we resolve anything on the user's behalf: never derive a target from attacker-controllable input without confirming the caller can read it.

### 9.3 Writes are always reversible

Every headless page write is one ordinary page version with a message, so page history reverts it — the property `addToPage.ts:32` already relies on. Custom-content writes are versioned the same way. Keep the version message distinguishable (e.g. naming the agent) so a reader can tell an agent edit from a human one in page history.

---

## 10. Analytics (plan first, per CLAUDE.md)

Registered in `src/utils/analytics/catalog.ts` and `types.ts` **as the first commit of the branch**, before implementation.

| Event | Trigger | Key properties |
|---|---|---|
| `agent_link_oauth_authorized` | user completes 3LO consent | `site_count` |
| `agent_link_oauth_revoked` | token revoked or refresh fails terminally | `reason` |
| `agent_link_diagram_created` | `create_diagram` returns | `result` (the `AddToPageResult` union), `diagram_type`, `macro_key_source` (`cached` / `discovered` / `unresolved`) |
| `agent_link_identity_unresolved` | §6 refusal | `cloud_id_hash` |
| `agent_link_headless_gate_evaluated` | §9.1 server-side paywall check | `is_paid`, `source`, `outcome` |

Plus a `mode: 'relay' | 'headless'` property added to the existing `agent_link_diagram_read`, `agent_link_edit_applied`, `agent_link_edit_failed`, `agent_link_search_performed` and `agent_link_list_performed` events, so every existing funnel splits by actor without new events.

---

## 11. Phases

**Phase 1 — identity resolver.** ✅ Landed 2026-09-19 (`functions/agent-link/macroIdentity.ts`, 35 unit tests, live-verified per §6). Standalone and testable against real sites before any OAuth exists. Riskiest piece, and the only one with a prior customer-visible incident, so it went first — a failure here cost nothing because nothing calls it yet.

**Phase 2 — analytics.** §10, per the CLAUDE.md hard rule. The two identity events landed *ahead* of Phase 1's code rather than after it, since the rule is "first commit of the feature branch"; the rest follow their own phases. Note they are unemitted until Phase 4 wires a caller — if that stalls, delete them rather than leave them lying around, as was done for `agent_link_guardrail_rejected` on 2026-09-02.

**Phase 3 — OAuth 3LO.** Register the app; implement the MCP OAuth flow (discovery, consent, refresh, revoke); token storage. This is the phase that decides whether users can install once and forget.

**Phase 4 — the headless writer.** Port `addToPage.ts`'s ADF logic into a shared module; implement read tools, then `update_diagram`, then `create_diagram` — with §9.1's server-side gate landing **before** `create_diagram` ships.

**Phase 5 — routing and reconciliation.** Mode selection in the MCP endpoint; `get_status` reports it; live relay unchanged.

**Phase 6 — rollout.** `agent-link-enabled` is still default-false (`src/apis/aiTitleFeatureFlag.ts:131`), so the live path has never reached users — both paths pilot together. Gate headless on its own flag so it can be pulled without taking the relay with it. Run the client matrix from the 2026-08-23 analysis §9 against Claude Code, Codex and Cursor.

---

## 12. Open questions

1. **Does the existing relay path survive unchanged, or does 3LO make it redundant?** This design says keep it (live render in the open iframe is a genuinely better experience). Worth re-testing after Phase 5 with real usage data rather than assumption — if nobody uses the relay, it is a lot of Durable Object machinery to maintain.
2. **Token storage.** Where refresh tokens live, and under what retention. Needs a decision before Phase 3 and a corresponding update to the Marketplace Privacy & Security questionnaires for all four variants (see the `forge-ps-questionnaire` skill) — we would be declaring storage of a new class of end-user credential.
3. **Does 3LO consent interact with the Forge app's install state at all?** They are separate registrations; a user could authorize 3LO on a site where our Forge app is not installed. §6's resolver refuses that case as a side effect, but the error message should say so plainly rather than blaming a missing macro.
4. **Version-message attribution.** What identifies an agent edit in page history, and whether customers want it configurable.
5. **Whether this warrants an ADR.** It reverses two locked decisions of a prior design; `docs/adr/0003-agent-link-mints-its-own-short-lived-token.md` is the closest existing record and is now partly superseded.

---

## 13. Evidence index

Every load-bearing claim above, with its source, so a reviewer can check rather than trust.

| Claim | Source |
|---|---|
| Backend's only Confluence credential is per-invocation Forge headers | `functions/forge-custom-content.ts:26`; `functions/forge-upload-attachment.ts:27-33`, `:419` |
| No webtrigger module; no OAuth code | `grep -rn "webtrigger" manifest.yml src/ functions/` → empty; OAuth grep matches only `x-forge-oauth-*` |
| Headless create works in 3 REST calls | `.claude/skills/create-test-page/scripts/create-test-page.mjs` (222 lines), `MACROS` at `:37` |
| Append-to-page is production code with dedupe + conflict semantics | `src/utils/byline/addToPage.ts` (307 lines): `:35`, `:50`, `:129`, `:140`, `:185`, `:244`, `:261`, `:270` |
| Malformed `extensionKey` rendered as unknown extension on a customer page | `src/utils/byline/addToPage.ts:23-24` (lite→full conversion, 2026-08-11, job `c5a6d954`) |
| Macro key varies by variant | `addToPage.ts:78-88`; `${SEQUENCE_MACRO_KEY}` in `manifest.yml`; `forge:deploy:*` scripts in `package.json` |
| 3LO supports all four required scopes | Atlassian, *Scopes for OAuth 2.0 (3LO) and Forge apps*, fetched 2026-09-19 |
| Dynamic web triggers force a major version | CLAUDE.md, *Forge app versions — major vs minor* |
| D1 must not store diagram bodies | CLAUDE.md, *Content management*; 2026-08-23 analysis §5 |
| Paywall gate is frontend-enforced | `src/utils/paywall/mountPaywallGate.ts:89`; `functions/api/space-status.ts` (auth via `validateContextToken`) |
| Agent Link has never shipped to users | `src/apis/aiTitleFeatureFlag.ts:131` — `checkFlag('agent-link-enabled', false)` |
| Custom-content type is `ac:<connectKey>:<contentKey>`, carrying no appId/environment | `src/model/ApWrapper2.ts:242-263`; `CONNECT_KEY` in `package.json` `forge:deploy:*` |
| Diagramly stores every diagram under one content key | `src/model/ApWrapper2.ts:40-47` (#524, observed production 2026-08-21) |
| Existing MCP tool surface is 6 tools, no `connect` | `functions/agent-link/mcpTools.ts:25` |
| Session TTLs | `functions/agent-link/sessionToken.ts:51-52` — 10 min idle, 60 min absolute |
