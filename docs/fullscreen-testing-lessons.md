# Fullscreen Bridge Modal — Testing Lessons

Captured from the multi-day session that landed `size: 'fullscreen'` modals,
the unsaved-edit close guard, and the automated coverage at
`tests/e2e-tests/tests/insert/close-guard.spec.ts`.

Most of these are non-obvious enough that they would have cost the next person
hours to rediscover.

## Forge bridge modal selectors

- The stable selector for our editor iframe is **`[data-testid="custom-ui-modal-dialog"]`** + `[data-testid="hosted-resources-iframe"]` — same as the existing `EditorPage.interactWithForgeDiagramMacro`. `[role=dialog]` works but is broader (Confluence shows other dialogs around publish).
- Inside the editor frame, drill further if needed: DrawIO renders an *inner* iframe, but our message handlers are on the OUTER (Vue) window. You don't have to round-trip a postMessage — just `window.dispatchEvent(new MessageEvent('message', { data: '...' }))` in the outer frame.
- The bridge fullscreen modal sits at `(0, 0, 1920, 835)` for `[role=dialog]`; the editor iframe at `(0, 70, 1920, 765)`. The 70px Atlassian-enforced header is unavoidable.

## Why "blocked" was almost always wrong

Three rounds of cases that I initially marked **blocked** turned out to be testable in a different way each time:

1. **Real beforeunload modal can't be Cancel'd in Playwright headless.** Playwright auto-dismisses `beforeunload` dialogs by default. → Use **synthetic dispatch**: `window.dispatchEvent(new Event('beforeunload', {cancelable:true}))` and read `event.defaultPrevented`. Deterministic, no real navigation.
2. **Versions UI doesn't render visibly.** I'd marked this "didn't see UI" → on retest, found the button only emits a console `getAndPrintContentVersions()` log + a brief tooltip. So it's *not blocked* — it ships a different UX than the test plan expected. Mark **pass** for what's shipped + flag the gap.
3. **Confluence-native dialogs (publish, close-clean).** Marked N/A on the lazy reasoning of "not affected by our work." The user's standing rule: don't substitute reasoning for coverage. Retest, observe, document.

The pattern: *blocked* and *N/A* are tempting hatches when verification looks expensive. Almost always, an angle exists — a synthetic dispatch, a `page.on('dialog')` handler, a `clipboard.readText()` probe, a JS-level state inspection.

## Synthetic beforeunload — the gotcha

```ts
// WRONG — the seed cancels the event before dispatch.
const e = new Event('beforeunload', { cancelable: true });
e.returnValue = undefined;   // WebIDL boolean coercion: undefined → false → cancels
window.dispatchEvent(e);
e.defaultPrevented;          // always true, even if no listener fires
```

```ts
// RIGHT — leave returnValue alone; only the handler should set it.
const e = new Event('beforeunload', { cancelable: true });
window.dispatchEvent(e);
e.defaultPrevented;          // accurate signal of whether a listener prevented
```

The `Event.returnValue` setter spec: "if its given value is `false`, set the canceled flag of the event." `undefined` becomes `false` via WebIDL `ToBoolean`. So pre-seeding to `undefined` corrupts the test.

Same gotcha applies if you instrument the editor iframe between cases — leftover `Object.defineProperty` getters on `window.specContent` or monkey-patches on `Event.prototype.preventDefault` will leak across dispatches. **Re-open the modal between independent dispatches** rather than reusing a contaminated frame.

## Lazy baseline capture for unsaved-edit guards

Two mounting models, two timing problems, same root cause: at component mount, the editor's source-of-truth state isn't populated yet.

### React (`react/Header.tsx` for OpenAPI)

`useRef` initialized in `useEffect` runs once on mount. At that moment `window.diagram?.code` may still be `undefined` (Swagger UI hasn't injected yet), so the captured baseline is `''`. After Swagger UI loads, comparison is `'YAML' !== ''` → always dirty.

**Fix:** capture lazily via `window.specListeners`. The first non-empty spec value the listener emits becomes the baseline. Until then, `isDirty()` short-circuits to `false`.

### Vue (`DocumentList.vue` for embed picker)

`mounted()` runs synchronously after `created()` *starts*, NOT after async work in `created()` completes. So at `mounted()` time, `this.picked` is still the empty-string default.

**Fix:** capture in the `picked` watcher (with `immediate: true`) the first time it sees a non-empty value with an id. Stash on the instance as `_originalPickedId`.

## Vite serves what it serves

- Hidden directories (`.playwright-mcp/`) are NOT served by Vite. Save screenshots that need to render in the test plan webpage to **`docs/screenshots/`** so they resolve at `/docs/screenshots/foo.png`.
- A stale Vite from a sibling worktree squatting on :8080 will silently serve THAT worktree's code under your tunnel session. Symptom: dev bar shows the wrong branch. `lsof -iTCP:8080 -sTCP:LISTEN` and `ps -p <pid>` reveal the cwd. (Documented in `forge-tunnel` skill, but you'll still hit it.)

## Test plan webpage as a small spec — and how it interacts with the test code

The test plan at `docs/fullscreen-test-plan.html` stores per-case state in `localStorage` keyed by `${sectionId}:${index}`. **Indexes are positional.** Inserting a new case in the middle of `PLAN[i].cases` shifts every subsequent case's status by one position.

Two practical consequences:
- Always **append** new cases, don't insert.
- After a case-list change, sanity-check: open the page, see which rows look "wrong" (e.g. a brand-new "close-guard.spec" case showing pass before you've ever run it = position shift).

Notes support inline screenshots via markdown `![](docs/screenshots/foo.png)` — see `renderThumbs()`. Bare paths to `*.png` also render. Broken images self-remove via `img.onerror`.

## When ad-hoc Playwright MCP commands stop being enough

After the second time a subagent ran the same `slash menu → insert macro → drill into modal → dispatch event` sequence, those steps belonged in checked-in code. Two-layer extraction:

1. **`tests/e2e-tests/helpers/CloseGuardHelper.ts`** — frame discovery, synthetic dispatch, per-editor dirty actions, real-X click + dialog capture.
2. **`tests/e2e-tests/tests/insert/close-guard.spec.ts`** — composes the helpers across all four editors via the existing `createPageAndSetup` infra.

The helper is small (~140 lines) but it captures the non-obvious bits *as inline comments*: the `returnValue` gotcha, the stale-instrumentation caveat, the DrawIO outer-window message trick. The next person doesn't rediscover them.

Run the spec on any Forge profile via `APP=zenuml-lite@stg pnpm test:e2e -- tests/insert/close-guard.spec.ts`.

## Subagent dispatch is the right unit of work for "test all N"

When the explicit scope is "test all four editors" or "retest the nine N/A cases," dispatching a subagent with the full protocol (environment, per-case strategy, reporting format, screenshot conventions) reliably converts a long checklist into a parallelizable batch. The subagent runs end-to-end without my per-step intervention; I review the report.

The big trap is shrinking the scope inside my own head before dispatching ("the others use byte-identical code, declared symmetry"). The user's "all" is theirs, not mine.

## Bugs I introduced and missed

The first round of close-guard wiring had two real bugs that only surfaced when I forced myself out of the "blocked" cop-out:

1. **OpenAPI:** `originalSpec.current` captured `''` at mount → always-dirty.
2. **Embed:** `ForgeEmbedEditor.vue` had no `setupCloseGuard` call at all.

Both were fixable in under 30 lines. Both would have shipped silently if I'd kept calling the cases blocked.

The lesson: when verification looks expensive, that's exactly when the bugs are hiding.
