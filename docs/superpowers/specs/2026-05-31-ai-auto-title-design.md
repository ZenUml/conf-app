# AI Auto-Title for Untitled Diagrams — Design

- **Issue:** [#171](https://github.com/ZenUml/conf-app/issues/171) — "feat: AI auto-title generation for Untitled diagrams"
- **Date:** 2026-05-31
- **Branch:** `feature/ai-auto-title` (isolated worktree off `main`)
- **Status:** Approved — ready for implementation plan

## 1. Summary

Revive and upgrade the dormant AI-title feature already present in `Header.vue`. Today a
manual "Sparkles" button calls `aiGenerateTitle` (Cloudflare Llama-2) behind a consent
modal, but the whole feature is force-disabled (`Header.vue:322`,
`this.aiTitleFeatureEnabled = false`). This work:

1. Re-enables the feature behind the existing **`AI_TITLE`** feature flag.
2. Adds an **auto-trigger while editing**: when a diagram has content but the title is
   still empty, generate a title automatically (debounced) with a spark → typewriter →
   dismiss animation.
3. Keeps a manual generation button (now without the consent modal).
4. Reuses the existing Cloudflare AI backend unchanged.

## 2. Decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| AI provider | **Cloudflare AI** (`@cf/meta/llama-2-7b-chat-int8`) | Already wired in; ~$0 at our scale (free tier covers ~16k titles/mo); 0.5–0.8s; good quality (tested). |
| Feature flag | Reuse existing **`AI_TITLE`** (KV `AI_TITLE_ENABLED_DOMAINS`) | Issue's `sparkDiagramAutoName` maps onto our existing flag. One flag gates both paths. |
| Trigger | **Auto while editing (debounced ~1.5s)** + manual button | Shows the animation while the user is in the editor; matches the issue's `init` UX. |
| Diagram types (v1) | **Sequence + Mermaid + PlantUML** | All are DSL text the type-agnostic prompt can read. |
| Confidence gate | **Dropped** | CF endpoint returns only a title string; a 7B confidence score is unreliable; the title is dismissable anyway. |
| Consent modal | **Removed entirely** (both paths) | Diagram content already goes to Confluence; titles are non-sensitive and dismissable. Popping a modal would break the "automatic" UX. |

## 3. Codebase-reality mappings (issue spec → our app)

- "Title is `Untitled diagram`" → our stored title is **empty `''`**. (`"Untitled diagram"`
  is only a display fallback in `GenericViewer.vue`.) Trigger when title is empty/whitespace.
- `POST /api/diagram-summary` returning `{ title, percentApplicability }` → reuse
  `POST /ai-generate-title`, which returns a **plain title string**. No applicability.
- DrawIO / mxGraph XML → out of scope (Graph type has no DSL text).
- "No write permission" guard → implicitly satisfied: the user is already inside the
  editor with edit rights. No extra check.

## 4. Architecture

The title block currently inlined in `Header.vue` (template lines 8–29) is extracted into
its own component so `Header.vue` stays lean and the state machine is unit-testable.

| Unit | Responsibility | Depends on |
|---|---|---|
| `src/composables/useAutoTitle.ts` (new) | State machine + orchestration: guards, content hashing/dedup, calls `aiGenerateTitle`, runs the typewriter, commits the title. | `aiGenerateTitle`, `getFeatureFlags`, Vuex `updateTitle` |
| `src/components/Header/DiagramTitleInput.vue` (new) | Presentation + wiring: title `<input>`, gradient spark, blinking cursor, dismiss ×, manual Sparkles button; debounced watcher that drives auto-generation. | `useAutoTitle`, store (`title`, `currentCode`, `diagramType`) |
| `functions/ai-generate-title.ts` (reuse) | Cloudflare Llama-2 title generation. Optional 1-line prompt nudge toward ≤60 chars. | `env.AI` |

`Header.vue` shrinks: it drops the inline title input + AI logic + consent `Modal` and
embeds `<DiagramTitleInput />`.

## 5. State machine (`useAutoTitle`)

Mirrors the issue's `DiagramAutoNameState`:

```ts
interface AutoTitleState {
  isGeneratingTitle: boolean;        // API call in flight
  suggestedTitle: string | null;     // server response
  displayedTitle: string;            // drives the input DURING animation only
  autoNameAnimationDone: boolean;    // typewriter finished
  hasManuallyEditedTitle: boolean;   // permanent lock for the session
  lastGeneratedContentHash: string | null; // dedup key
}
```

**Guards** — all must pass for auto-fire:

1. `AI_TITLE` flag enabled.
2. Title is empty/whitespace.
3. `!hasManuallyEditedTitle`.
4. `!isGeneratingTitle` (concurrency lock).
5. Content (DSL) non-empty.
6. `contentHash !== lastGeneratedContentHash` (dedup).

Dropped from the issue: confidence threshold; "no write permission" (N/A in editor).

**Content hash:** lightweight FNV-1a / djb2 string hash — no crypto dependency.

**Type param** for the API call:
- `Sequence` → `'sequence'`
- `Mermaid` → `getMermaidType(code)` (existing helper in `Header.vue`)
- `PlantUml` → `'plantuml'`

## 6. Data flow & the three phases

1. `DiagramTitleInput` watches `{ currentCode, title }`. When guards pass, debounce **~1.5s**,
   then `generate('init')`.
2. **Phase 1 (generating):** set `isGeneratingTitle`; gradient spark ✦ fades in to the left
   of the title. Existing (empty) title unchanged. Call `aiGenerateTitle({ dsl, type })`.
3. **Phase 2 (typing):** on response, animate `displayedTitle` char-by-char at **40 ms/char**
   with a blinking purple right-border cursor (`#7C3AED`); the dismiss **×** appears
   simultaneously. The input displays `displayedTitle` while animating.
4. **Phase 3 (done):** commit the full title to the store (`updateTitle`); remove the cursor;
   spark fades out (opacity→0, scale→0.6, 400 ms); **× remains**. Store
   `lastGeneratedContentHash`. Publish is now enabled.
5. **Dismiss ×:** `updateTitle('')` (revert to empty / "Untitled"); fade out × and any
   residual spark. Because `lastGeneratedContentHash` is already set, **no re-trigger until
   the DSL changes** — this is how the issue's "no re-trigger" rule is implemented.
6. **Manual-edit lock:** typing in the input sets `hasManuallyEditedTitle = true` and aborts
   applying any in-flight result (via a generation token), permanently disabling auto-fire
   for the session.

**Manual button:** `generate('user')` directly (no modal). Manual generation may bypass the
empty-title guard (the user explicitly asked) but still respects the concurrency lock.

## 7. Concurrency / re-entrancy

- During animation the input is driven by local `displayedTitle`, not the store, so
  progressive UI updates don't re-fire the watcher.
- The empty-title and `isGeneratingTitle` guards also block re-entry.
- A monotonically increasing **generation token** ensures a stale async result is dropped if
  the user edited the title or dismissed while a request was in flight.

## 8. Error handling

- **Auto path:** failures reset state **silently** (no toast) — avoid noise for an
  unsolicited action.
- **Manual path:** keep today's toast-on-error behavior.

## 9. Testing

- **Vitest `useAutoTitle.spec.ts`** (primary; mirrors `useCustomerSuccessService.spec.ts`):
  each guard (flag off, title already set, manual-edit lock, concurrency, dedup-hash, empty
  content); success commits the title; dismiss reverts + dedups; failure resets silently.
  Mock `aiGenerateTitle` + `getFeatureFlags`; fake timers for the typewriter.
- **Component mount test** for `DiagramTitleInput` — phase transitions with fake timers
  (spark visible during generating; × appears at typing start; cursor gone + spark faded at
  end). Lighter.
- **Playwright e2e** — follow-up. The title input lives inside the Forge iframe; the unit
  layer covers the acceptance criteria.

## 10. Acceptance criteria mapping (issue → here)

| Issue criterion | Where satisfied |
|---|---|
| Fires only for empty/"Untitled" title | Guard 2 (§5) |
| Spark fades in on generation start | Phase 1 (§6) |
| Title clears + types at ~40 ms/char w/ blinking purple cursor | Phase 2 (§6) |
| × appears with typing start | Phase 2 (§6) |
| × reverts to Untitled + no re-trigger until content changes | Dismiss (§6), dedup hash |
| Spark fades out after typing; × remains | Phase 3 (§6) |
| `percentApplicability < 70` discarded | **Dropped** (§2) — endpoint returns no score |
| No re-trigger if XML hash unchanged | Guard 6 (§5) |
| Gated behind a feature flag | `AI_TITLE` (§2) |
| No auto-trigger after manual title edit | Guard 3 + manual-edit lock (§5/§6) |

## 11. Out of scope (v1)

- OpenAPI and DrawIO/Graph auto-title.
- Backend confidence scoring / new `/api/diagram-summary` endpoint.
- Turning the `AI_TITLE` flag on in production KV (separate ops step; needs explicit go-ahead).

## 12. Cost note (recorded for posterity)

Cloudflare Workers AI: ~18 Neurons/call (fp16 upper bound), free tier 10,000 Neurons/day
(~16k titles/mo). Our `create_macro_end` volume is in the low hundreds/month, so the feature
is effectively **$0**; even 200× growth (~100k titles/mo) is ~$16/mo.
