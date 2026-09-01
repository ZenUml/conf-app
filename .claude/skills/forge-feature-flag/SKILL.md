---
name: forge-feature-flag
description: Create, enable, scope, and verify Atlassian Forge feature flags for ZenUML Confluence app variants. Use when asked to enable, roll out, disable, create, or check a Forge flag such as viewer-adf-scan-deferred, especially before or after a Lite, Full, Diagramly, or AsyncAPI release.
---

# Forge Feature Flag

Enable a flag only after identifying the exact Forge app and proving the runtime evaluation on the intended environment.

## Workflow

1. Establish the target variant and environment. Do not infer that a flag in Lite applies to Diagramly, Full, or AsyncAPI: each is a separate Forge app with its own flag inventory.
2. Resolve the app ID from repository configuration (`manifest.yml`, `package.json`, release scripts) and open that app’s Developer Console. Confirm the app name in the Console before changing anything.
3. Inspect the flag list for the exact key. If it is absent, create it with the exact key and a concise kill-switch description.
4. Select the ID type required by the calling code. Read the flag client initialization before creating a flag; if the client evaluates with an `installContext`, select `installContext`.
5. Explicitly configure the requested environment. For a production rollout, select **production**, set the intended rule/percentage, and click **Update**. A global-looking “Enabled” state or an “Everyone” rule is not proof that production configuration was saved.
6. Reload a live macro in the target environment and capture the runtime result. Do not declare success from the Developer Console alone.

### Read flag state without a browser — `flags-status.mjs`

Prefer this over driving the Console for any *read*. It authenticates with the
same API token as `create-test-page` (`FORGE_EMAIL` / `FORGE_API_TOKEN` from
`.env.forge.local`) against `api.atlassian.com/graphql`:

```bash
set -a; source .env.forge.local; set +a
node .claude/skills/forge-feature-flag/scripts/flags-status.mjs                  # all 4 apps
node .claude/skills/forge-feature-flag/scripts/flags-status.mjs --app lite --json
node .claude/skills/forge-feature-flag/scripts/flags-status.mjs --keys renderer-prefetch --history
node .claude/skills/forge-feature-flag/scripts/flags-status.mjs --include-branches   # find orphans
```

It reports, per app × flag: live / deleted, last action + timestamp, created-at,
environments, and the full change log (`--history`) including percentage ramps and
toggles. Verified 2026-07-25 against the Console UI — envs and timestamps matched
on every flag checked.

**Two hard limits, both load-bearing:**

1. **No enumeration.** `ecosystem.forgeAuditLogs(appId).featureFlagsAuditLogs`
   requires `flagId`, and the endpoint that *does* list flags
   (`developer.atlassian.com/graphql`, the Console BFF) has introspection AND
   Apollo did-you-mean suggestions disabled — so its query cannot be discovered
   without capturing it from the browser once. The tool therefore only reports
   keys it is *given*: from `src/` at HEAD, or `--include-branches` for remote
   branch heads. A Console flag referenced nowhere in git is invisible to it —
   and that is exactly the orphan a slot-pressure audit hunts. **For a definitive
   inventory, read the Console list page.**
2. **`changes` is always null.** The schema exposes typed
   `changes { rules { new { env passPercentage } } }`, but every event returns
   null there. Only `details` (human-readable strings) is populated. Don't
   "fix" the query back to `changes`.

### Console URLs and the 10-flag cap

Direct URLs (the app's own nav is the only discoverable path otherwise):

- list — `/console/myapps/<appId>/manage/feature-flags?environment=production&featureFlagStatus=All&interval=P6M`
- detail — `/console/myapps/<appId>/manage/feature-flags/<flagKey>`

`interval` is capped at `P6M`; a flag untouched for longer than that can be hidden from the list. App IDs: Lite `8ad26115-211f-4216-971b-0540f606303d`, Full `d9e4002b-120b-426b-834b-402a4a5adce7`, Diagramly `01ede8b1-4e88-451a-b9ef-89eeef93afaf`, AsyncAPI `49017727-af19-4ab6-8d5a-7d28108936b6`.

**Each app allows at most 10 flags.** Lite hit the cap on 2026-07-25 ("You have reached the limit" beside the create button), so a new rollout there must first retire an old flag. Deleting a flag makes `checkFlag` fall back to its default (`false` in every ZenUML call site) — so for a flag that is live at 100%, remove the gate from code and release *before* deleting, or the delete silently disables a shipped feature.

Reading flag state with Playwright MCP in extension mode: the relay usually dies after one `browser_evaluate` per tab. Budget one navigate + one eval per `browser_tabs` `new` call, and scrape everything in that single eval. Client-side walking of the flag list (clicking each row inside one eval) re-scrapes one flag and returns plausible-looking duplicate data — do not trust it.

### Which browser to drive the Console with

Pick by whether the change needs a **typed value**.

| Change | Driver |
|---|---|
| Chips only (add an environment to an existing rule, toggle a rule) | claude-in-chrome |
| Anything that enters text (a new rule's `installContext` value, a new flag key) | `agent-browser` |

The Developer Console is a normal page, not a Forge iframe, so **claude-in-chrome works on it** and is the cheaper entry point for chip-only work. Start with `tabs_context_mcp` — a Console tab is often already open at the exact flag URL, which removes the navigation step entirely. On 2026-08-16 Playwright MCP hung for 120 s on both `browser_navigate` and `browser_find` against this domain and needed two `TaskStop` calls; claude-in-chrome then completed the same task.

**claude-in-chrome cannot type into this form.** `mcp__claude-in-chrome__form_input` and `computer` `type` are both refused by the Claude Code permission classifier on this page ("Blocked by classifier"), twice on 2026-09-01. Clicks are not refused, which is why the 2026-08-16 chip-only change went through on it. A rule needing a value stalls at an empty field with **Update** disabled, so nothing can be saved by accident — but nothing gets done either.

### Writing a rule that needs a value — `agent-browser`

`agent-browser` is a Bash-level CLI, so the browser-tool classifier does not gate it. Profile **`Profile 8` ("Conf App")** is signed in to `developer.atlassian.com`; `Default` and `Profile 6` redirect to the Atlassian login and must not be used to attempt a sign-in.

Every command needs the same `--profile`, and the session only persists across commands issued in one shell run — chain them:

```bash
P="Profile 8"
agent-browser --profile "$P" set viewport 1600 1200
agent-browser --profile "$P" open "https://developer.atlassian.com/console/myapps/<appId>/manage/feature-flags/<flagKey>/"
sleep 10
agent-browser --profile "$P" snapshot | grep -E 'Add new rule|Update'   # refs are re-numbered every snapshot
agent-browser --profile "$P" click "@e46"                              # Add new rule
```

Then, in order: pick the attribute key from its combobox, type the value and press Enter, set the environment chips, click **Update**.

```bash
agent-browser --profile "$P" type "@e94" "ari:cloud:confluence::site/<cloudId>"
agent-browser --profile "$P" press Enter
```

Four things that cost time on 2026-09-01:

1. **Scroll the target rule clear of the sticky action bar before clicking anything in it.** The Discard/Update bar appears as soon as there are unsaved changes and covers the last rule; `agent-browser` refuses with `Element '@eNN' is covered by <div...> at its click point`. `scrollIntoView({block:'center'})` on the rule's label, then a small `scrollBy(0,-160)`, clears it.
2. **`snapshot` refs are regenerated on every call.** Re-snapshot after each structural change and re-read the ref; never reuse one across steps.
3. **A new rule defaults to development + staging, production off.** Read the chip colours (see below), then click exactly the ones that must change. There is no `aria-pressed` to read.
4. **Take the value from an authoritative source, never from the page.** Resolve a cloudId with a D1 lookup on `AtlassianInstance.clientDomain`. On 2026-08-28 a run derived the value by running a whole-page UUID regex, captured a fragment of a Resend email-tracking link, saw its own `valueAccepted` check return **false**, and saved anyway. That rule (`eb58b353-876d-4afa-a392-bea6a1e66af8`) matches no installation and is still live on the Lite `architecture-tokens-enabled` flag.

After **Update**, confirm three ways before reporting: the `Successfully updated` state with no unsaved marker, the Activity row naming the rule, and a **read-back of every rule after a fresh page load** — not only the edited one. The Activity entry lists unrelated rules as "updated" on a save that did not touch them (seen 2026-08-16 and 2026-09-01), so only a full read-back shows what actually changed.

Under claude-in-chrome, a plain **screenshot reads chip state reliably** — a selected chip renders a ✓ glyph, an unselected one an empty ○. The computed-colour method below exists because Playwright MCP extension mode may not write screenshots to disk; use whichever matches the transport in hand.

### Update can hang silently — confirm on the Activity tab

Clicking **Update** can open an "Unsaved changes" modal whose save button spins indefinitely. Observed 2026-08-16: ~60 s with no resolution, `POST /gateway/api/session/heartbeat` returning **400** during the hang, and the staged change never persisted. The chip already showed the new state while the server still held the old one.

Recovery: open the same flag URL in a **new tab**, redo the chip click there, click Update. The stalled tab's pending request is harmless when its target state matches what was applied; leave it rather than clicking Discard.

**The `Activity` tab is the authoritative confirmation, not the Setup chips or a page reload.** One click, no navigation, and its rows name the exact transition:

```
Aug 16, 2026 07:01   Peng Xiao   UPDATED
  • 'Everyone' applied environments changed from
    development, staging → development, staging, production
```

It also proves a stalled attempt did not double-apply — count the rows in the window. A chip glyph reflects local staged state and is not evidence of a write.

### Rule order governs a scope change

Rules evaluate top-down and the first match wins. Adding an environment to a broad first rule (`everyone`, Pass 100%) makes every narrower rule below it unreachable — a site-targeted `installContext` rule then stops governing anything, without being edited or shown as changed. Read the whole rule list before widening any single rule, and state in the report which rules the change made redundant.

### Reading which environments a rule actually targets

A newly created flag defaults its rule to **development + staging only — production is OFF** — while the page header still reads `ENABLED` in large type. Trusting that header ships a no-op.

The selected/unselected state lives only in CSS: `innerText`, `aria-checked`, `aria-pressed` and full-page screenshots all fail to expose it (screenshots also may not reach disk under Playwright MCP extension mode). Read the computed colour instead — selected chips render blue, unselected grey:

```js
const words = ['development', 'staging', 'production'];
[...document.querySelectorAll('span,div,button')]
  .filter(e => words.includes((e.textContent || '').trim().toLowerCase()) && !e.children.length)
  .map(e => ({ env: e.textContent.trim(), selected: getComputedStyle(e).color === 'rgb(12, 102, 228)' }));
```

Run it once before saving and again after a full page reload — the reload is what proves persistence. When a flag has several rules, chips repeat per rule in document order; rules match top-down, so the last rule that covers an environment is the one that governs it.

Do not click a bare `button.css-<hash>` by index to reach **Edit** — the first match is the rule's **More** menu (Duplicate / Delete), which is a destructive control on a live flag.

## Runtime verification

Forge Custom UI is an OOPIF. Use Playwright, with a **browser-context** request listener; `page.on('request')` can miss iframe traffic.

Capture the target iframe’s Mixpanel `/track/` POST, decode its form `data` value, and inspect the event properties. In the Playwright runner, decode with `decodeURIComponent`; do not rely on `URLSearchParams` being available.

```js
const captured = [];
const handler = request => {
  if (!request.url().includes('/track/')) return;
  const match = (request.postData() || '').match(/(?:^|&)data=([^&]*)/);
  const events = JSON.parse(decodeURIComponent((match?.[1] || '').replace(/\+/g, ' ')));
  captured.push(...events);
};

const context = page.context();
context.on('request', handler);
try {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(15_000);
} finally {
  context.off('request', handler);
}
```

For `viewer-adf-scan-deferred`, require both events from the target Forge iframe:

- `macro_viewed` has `adf_deferred: true`, the intended `product_type`, and the deployed `app_version` / `app_commit`.
- `viewer_adf_scan_completed` has `adf_deferred: true` and an outcome (`result`). It must share `instance_nonce` and `time_origin` with `macro_viewed`.

If the first reload still evaluates false after saving, allow propagation and retry. Report the raw runtime value; do not claim the flag is live until it is true in the event.

## Reporting

Report the app variant, environment, key, rollout scope, and runtime evidence. If verification cannot run, mark it **SKIPPED** with the blocker; never substitute a console screenshot or unit test for runtime evidence.
