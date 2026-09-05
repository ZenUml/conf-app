# Page Banner — UX & DX state of play

Reference for whenever we consider adding a `confluence:pageBanner` (Forge) module to conf-app. Captures what the module is like **today** and the open UX/DX problems developers have raised. Use this to sanity-check any banner work before we ship one to users.

Primary source: [Atlassian developer community — Feedback on the new page banner module](https://community.developer.atlassian.com/t/feedback-on-the-new-page-banner-module/92605) (Nov 2025).

## What it is

- Forge module: `confluence-page-banner` (declared in `manifest.yml`).
- Renders an app-controlled iframe **above the page content** on every Confluence page in the site.
- Visibility can be narrowed via `displayConditions`, but only static rules — no runtime/business logic gate. Hiding the banner conditionally happens *after* the iframe has already loaded.

## How it behaves today

| Aspect | Current behaviour |
|---|---|
| Where it renders | Above page content, on every page (subject to static `displayConditions`) |
| Load order | Confluence reserves space and mounts the iframe **before** it knows if your app will render anything |
| Sizing | App-controlled inside the iframe, but Confluence reserves a default-height slot during load |
| Dismiss / persistence | No platform-provided dismiss UI or persistence — the app must build it |
| Navigation | Triggers a banner reload on URL changes (e.g. tab-bar navigation within a page) |
| Mobile | No documented mobile-specific handling |
| Loading affordance | Generic Forge spinner shown during iframe boot (Lambda cold start visible to user) |

## Open UX issues — quote the developers

These are the concrete complaints raised in the thread. Treat them as the bar our own banner has to clear.

1. **Layout shift / flicker (≈150 px).** Even after Atlassian's first fix, Confluence briefly shows a large empty banner slot when the app ends up rendering nothing. One reporter calls this "unusable" because of the ~150 px jump during navigation. Multiple banners stacking makes it worse.
2. **Cold-start spinner.** Forge Lambda cold starts mean users see a loading spinner even for banners that ultimately return *static* content. Bad for perceived performance and for any banner meant to be unobtrusive.
3. **Reload on in-page navigation.** Tab-bar style URL changes inside a single Confluence page cause the banner iframe to reload, re-triggering both the spinner and the layout shift.
4. **No runtime conditional rendering.** `displayConditions` only supports static rules. Anything dynamic — "show only if this space has feature X", "hide once dismissed", "show only to admins on first visit" — has to be done *after* the iframe boots, which is exactly when the layout shift happens.
5. **No first-class dismiss / persistence.** Apps must build their own dismiss button + remember-state mechanism. Nothing standard for "user X dismissed banner Y", so every app reinvents it (and they all flicker on the next visit before "dismissed" state is read).
6. **Performance compounds with multiple banners.** Each app's banner is a separate iframe + cold start + layout reservation. Two or three installed banner apps multiply the cost.

## Atlassian response (as of late Nov 2025)

VickyHu (Atlassian) acknowledged the feedback and shipped an initial fix that improved but did not eliminate the flicker. No public commitment yet on: dynamic display conditions, dismiss API, or sizing/reservation behaviour. Don't assume any of these are coming — design for the current behaviour.

## Checklist before we ship a page banner

If we ever add `confluence:pageBanner` to lite/full/diagramly:

- [ ] **Do we actually need site-wide?** A banner inside the macro viewer is cheaper and doesn't pay any of the costs above. Default to no banner.
- [ ] **Static `displayConditions` first.** Narrow to the smallest set of pages/spaces/users that we can express statically. Don't rely on a JS check post-load.
- [ ] **Render *something* immediately, or render nothing-but-zero-height.** If the banner can be empty for a given user, return a zero-height response — don't let Confluence reserve 150 px and then collapse it.
- [ ] **No Lambda work in the hot path.** Decide visibility from cached/context-only data so the iframe doesn't depend on a cold-start network call. If we need data, prefetch and cache it before render.
- [ ] **Dismiss state lives in our storage, read synchronously.** Plan for "user dismissed this 2 minutes ago" to be reflected on the very next page load — no second flash.
- [ ] **Test in-page navigation.** Specifically: tab-bar / anchor / `pushState`-style URL changes within the same page. Confirm the banner doesn't re-flash.
- [ ] **Stacking test.** Verify alongside at least one other installed banner app, since real customers will have more than one.
- [ ] **Mobile pass.** No platform guidance exists; visually check on a narrow viewport and on the Confluence mobile web view.
- [ ] **Analytics for actual visibility, not just "mounted".** `paywall_triggered`-style events should fire when the banner is *visibly* shown to the user, not when the iframe boots — otherwise we'll over-count by the same margin as the flicker problem.

## What occupies the slot today

One `confluence:pageBanner` module (`zenuml-page-banner`) hosts all of them, and
`src/routes/pageBanner.ts` picks at most one per page load. In priority order:

Two modules, not one:

| Module | Choice | Component | Gate |
|---|---|---|---|
| `zenuml-page-banner` | `paywall` / `paywall-admin` | `UpgradePrompt/PaywallWarningBanner.vue` | localStorage targeting marker written by the macro iframe |
| `zenuml-page-banner` | `csat` | `CSAT/CsatBanner.vue` | a fresh CSAT trigger in localStorage **and** no live per-account suppression |
| `zenuml-page-banner` | `unplaced` | `Byline/UnplacedDiagramsBanner.vue` | localStorage fallback marker (creator-only), used when the property write was denied |
| `zenuml-unplaced-banner` | `unplaced-property` | `Byline/UnplacedDiagramsBanner.vue` | **`displayConditions` on a content property — evaluated by Confluence, server-side** |

`zenuml-page-banner` is the shared host: paywall and CSAT targeting live in
localStorage, which Confluence cannot see, so the iframe must boot to decide.
Inside it, `unplaced` sits last because it is the only one of the three that
keeps — a diagram saved on a page and placed nowhere on it is still unplaced
tomorrow, and its banner re-arms itself. A CSAT window closes; a paywall block is
happening now.

That order is enforced in TWO places, and it has to be. Inside the shared host a
cascade is enough: it picks one. The gated module is a separate iframe that
Confluence renders on its own, so the cascade cannot reach it — it asks the same
question itself, before doing anything, via `higherPriorityBannerPending()` in
`utils/banners/priority.ts`. Those are the same synchronous localStorage reads
the host makes, which is what makes it safe across two iframes that cannot talk:
they are not coordinating, they are reading the same facts and reaching the same
conclusion. No handshake, no race, and yielding costs nothing because it happens
before the property read.

A yield has to be worth something, and the CSAT branch originally was not. It
asked whether a trigger had been ARMED (`csatPending`, written by every save,
fresh for 10 minutes) — but whether the survey may actually SHOW is a second,
per-account question (`csat_state`, the 7-day record a Dismiss writes) that
`CsatBanner` asked for the first time on mount, asynchronously, after the yield
was already spent. For anyone who had dismissed the survey that week the two
answers disagreed and the page showed NO banner at all for ten minutes after
every save: the unplaced notice stood down, and the survey it stood down for
closed itself. Both questions are asked in the cascade now, via
`isCsatSuppressed()` in `utils/csat.ts` — the one place either side reads that
record, so the banner's own gate (`useCSATState.checkStateOfCSAT`) and the
cascade cannot drift apart again. It stays a plain synchronous localStorage
read: the account id comes off the Forge context, which `forgeIndex` resolves
before any banner code runs.

Yielding is measured (`result: 'yielded'`, with `suppressed_by`) because a notice
that never gets the slot looks exactly like a notice nobody needs.

`zenuml-unplaced-banner` is the one module in this app that escapes the whole
cost model at the top of this document: its condition is page state, so
Confluence never creates the iframe on a page with nothing to say.

### The unplaced-diagram notice

Says the thing the byline already knows — a diagram was saved from the byline and
never pasted, so it costs a Lite macro slot and renders nowhere — on the surface
that is actually read. Confluence boots the byline iframe only on CLICK (5 opens
against 39,197 macro views), so its own "· not on this page" label reaches almost
nobody.

Three rules keep it inside this document's checklist:

- **Nothing on the hot path — for pages with nothing to say.** The primary gate
  is Confluence's own `entityPropertyExists`, so an unaffected page does not boot
  an iframe at all; the fallback gate (`isUnplacedBannerCandidate`) is
  synchronous localStorage, and the component is its own lazy chunk either way.
  Be precise about what that does *not* cover: on a page the gate admits, the
  component awaits a property read **and** an ADF read before it can show or
  close, so the two outcomes that end in `view.close()` hold the reserved slot
  for two round-trips — the flicker item 1 of this document calls "unusable".
  That cost is bounded (only pages that carry the property, and a dismissal goes
  quiet for a day without any read at all) but it is real, and it is the first
  thing to attack if the banner ever feels heavy.
- **Never claim what we cannot verify.** The record states what the byline saw;
  the user may have pasted the link a second later. Past the gate the component
  re-reads the page ADF and shows only entries still unreferenced. A failed scan
  shows nothing; a scan that finds everything placed retires the record — the
  property is DELETED, taking the page back off the gate.
- **One page, one banner.** Three guards, because the first two are not enough
  on their own. The byline stamps `viaProperty` on the fallback marker so the
  shared host stands down whenever the gated module has it — but that records
  only what THIS browser managed to write, so the component ALSO re-reads the
  property on the fallback path and stands down unless it comes back `absent`
  (fail closed: a `forbidden` or `error` read is not evidence that no property
  covers the page). And the record carries the page it was scanned on, checked
  on read — see "When the record is written".
- **Say it about the right page.** `referencedCustomContentIds` proves only that
  the page does not RENDER an entry, which is trivially true of a diagram
  belonging to some other page — so verification alone cannot catch a record
  that reaches the wrong page, and one did (below). The fallback marker stamps
  `pageId` and the reader checks it, reporting `page_mismatch` rather than
  speaking. An unstamped record cannot say which page it describes and is
  treated the same way; the byline restamps it on its next open.

### Where the record lives

The store is a content property, `zenuml-unplaced-diagrams${LITE_KEY_SUFFIX}`,
written by the byline as the user. Verified against lite-stg on 2026-08-31:
POST `200`, GET `200` (`results: []` when absent), PUT with version n+1 `200`,
PUT with a stale version `409`, DELETE `204` — and **the page's own version
never moved**, so property writes leave no trace in page history.

The key is variant-suffixed for the reason space properties are: they are
site-global across apps, so an unsuffixed key would let Full's banner boot on a
property Lite wrote.

Permission was the design's one unproven assumption, and it is now checked: on
2026-09-04 a non-admin account (`update:page`, `admin? false`) both created the
property from the byline and deleted it from the banner on whimet4. What remains
untested is a READ-ONLY viewer, who should be refused — a denial is handled, not
assumed away: the byline falls back to the per-browser marker (creator-only
reach) and `unplaced_property_write` reports how often that happens, with
`unplaced_source` on the banner events reporting the same ratio from the other
end.

### When the record is written

Only from the byline iframe, and only in three moments — every one of them a
`syncUnplacedState()` call in `BylineDiagrams.vue`, which is the single place
that writes:

| Where | Trigger |
|---|---|
| `:726` | The byline panel is **opened** — in `loadDiagrams()`'s `finally`, once the page-diagram list resolves. Never awaited: the rows must paint without waiting on a write meant for the next page load. |
| `:1137` | A diagram is **saved or cancelled from the byline's own create flow**. A diagram created here is unplaced by definition — the paste has not happened — so this is the write that arms the banner for the create→paste gap. |
| `:960` | **"Add to page" succeeded**, so the set just shrank. |

The banner deletes in two more: when it verifies a record stale (everything in
it is placed now, `UnplacedDiagramsBanner.vue:395`) and when the last row is
placed (`:482`).

**So the record only ever moves when someone clicks the byline.** That is the
same 5-opens-against-39,197 number this banner exists because of, and it cuts
both ways: a page nobody opens the byline on never gets a record at all, and a
page whose diagrams were placed long ago keeps a stale one until either the
byline is opened again or the banner retires it. Any feature that wants a
fresher record needs a new write site, not a tweak here.

Two guards inside `syncUnplacedState()` decide nothing is written:

- **`placedIds` undefined** — the ADF scan failed. An unreadable page must never
  be recorded as "everything is unplaced", the same trap `isUnplaced` guards.
- **`hostInEditor`** — the scan reads the PUBLISHED ADF, so a diagram the author
  just pasted still reads as unplaced. In the byline that only ever added a Copy
  URL button for the author; recorded to the property it becomes a banner shown
  to everyone, asserting something we cannot verify while a draft is open.

And `persistUnplacedProperty` itself decides what reaches the API. It reads
first: `forbidden` → no write (this is what the localStorage fallback exists
for); `error` → no write either, because an unreadable property is not a licence
to overwrite it — a POST would 409 against a key we merely failed to read, and a
blind delete would discard a set we cannot see. An **empty list DELETEs**, since
the property's presence IS the display condition. Same entry ids as before →
`unchanged`, no request at all, which keeps `updatedAt` stable so a user who
dismissed the banner is not shown it again for merely reopening the byline.
Otherwise POST (absent) or PUT with version n+1, retried once on 409.

### Why a user may see no banner on a page that has the property

Per-browser suppression, all deliberate, all in localStorage under
`bylineUnplacedBanner:<domain>:<pageId>`:

- **`isDismissalQuiet`** — dismissed within `DISMISSAL_QUIET_MS` (24 h). Closes
  before reading the record at all, so a dismissing user buys no REST call.
- **`dismissedFor === record.updatedAt`** — dismissed for this exact record
  version. Only a NEW diagram re-arms it.
- **`hasExhaustedShows`** — `MAX_BANNER_SHOWS` (5) impressions of this record
  version. Enough to silence it for anyone testing in a few reloads.

All three report `unplaced_banner_evaluated` (`dismissed_quiet`,
`dismissed_version`, `shows_exhausted`), which is what separates "the gate never
fired" from "everyone already said no" without needing a browser.

### One-click place

"Add to page" appends the macro node to the page ADF and publishes one version
(`utils/byline/addToPage.ts`), rather than leaving the user the copy → open
editor → paste → publish flow they already abandoned once. It is offered
optimistically — `canEdit` starts `true` and flips off only after a write
returns `forbidden`, which costs a refused click instead of a permissions
request on every banner load; `diagram_added_to_page`'s `forbidden` share is the
signal to revisit that. On success the host page is reloaded
(`router.reload()`), because the write changes the STORED ADF and the rendered
page does not follow — without it the success case looks like nothing happened.
The reload waits until the surface has nothing left to place: a full page load
between two clicks would cost the user the second one.

### Checklist items still open

Recorded rather than quietly skipped, because the checklist above is the bar:

- **Stacking.** The paywall/CSAT host and this module are separate iframes, so a
  page carrying the property AND an eligible paywall warning shows both. Not
  verified against a third-party banner app.
- **Mobile.** Not visually checked on a narrow viewport or the Confluence mobile
  web view.
- ~~**In-page navigation.**~~ Measured on whimet4, 2026-09-05, across link
  clicks and browser Back/Forward between a page carrying the property and one
  without: Confluence tore the banner iframes down and rebuilt them on every
  transition (the `iFrameResizer` counter advances; no old id survives), one
  banner on the property page and none on the control, sampled 0.5 s → 20 s. A
  banner that appeared to persist onto another page turned out to be a fallback
  record from a different page — fixed by the `pageId` stamp above, not by
  anything about navigation.
- **Read-only viewers.** See above.

## Related in this repo

- `manifest.yml` — where a `confluence:pageBanner` module would be declared per variant.
- `src/utils/upgradeTracking.ts` — analytics pattern to mirror if a banner ever fires events.
- `docs/upgrade-tracking-event-reference.md` — event-naming reference; reuse `ui_component` to distinguish banner from modal/viewer-notice surfaces.
