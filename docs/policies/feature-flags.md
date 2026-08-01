# Feature flags — decision framework: Forge flag or Cloudflare KV?

We run two feature-flag providers. This is the decision framework for choosing
between them when you introduce a new toggle — work through Step 0, then the
questions in order; **the first question that answers "yes" decides the
provider**. The worked examples at the end classify every current flag with
its reasoning, so you can decide new cases by analogy.

## The two providers in one line each

- **Forge feature flag** — a boolean created in the Forge Developer Console
  per app, evaluated client-side in the Custom UI iframe via the
  `@forge/bridge` `FeatureFlags` SDK. Console-toggled, env-targeted,
  percentage-rampable, per-install targetable. Our backend is not in the path.
- **Cloudflare KV flag** — a KV record (arbitrary JSON) in the
  `KV_FEATURE_FLAGS` namespace, evaluated server-side by
  `functions/feature-flags.ts` and fetched by the frontend per client domain
  (`src/apis/featureFlags.ts`). Toggled with `wrangler kv`, no deploy.

## Step 0 — is a feature flag the right tool at all?

Rule out the neighboring mechanisms first; mis-filing here is the most common
mistake:

| If the thing you're gating is… | Use instead |
|---|---|
| Different behavior per **product variant** (lite/full/diagramly/asyncapi), fixed at release | `PRODUCT_TYPE` build-time gating / manifest strip — not a runtime flag |
| **Who paid / who is entitled** (space licenses, per-user extensions) | `SPACE_LICENSE_KV` `license:*` entitlement records (`/api/space-status`) — entitlements, not flags |
| **Which users belong to a targeting group** for messaging/UX experiments | `cohort:user:*` records (`/api/user-cohorts`) |
| A **developer-only override** for local testing | `localStorage` mocks (`mockCSSEnabled`, `mockAiTitleEnabled`, …) |

If none of those fit — you genuinely need a runtime on/off or config dial —
continue.

## The decision questions (in order, first "yes" wins)

**Q1. Does server-side code need to read it?**
If a Worker / Pages Function branches on the value → **Cloudflare KV**.
Forge flags are evaluated only inside the Custom UI iframe; our backend
cannot see them. (Corollary: if both client *and* server must see one
decision, the KV value is the source of truth and the client fetches it.)

**Q2. Is the value more than a boolean?**
Per-domain config objects, allowlists, anything with a payload → **Cloudflare
KV**. Forge flags are booleans, full stop. Don't encode data into a
constellation of booleans.

**Q3. Is it operator-curated per tenant domain?**
"Enable this for acme-corp and these 12 other customers, with per-customer
settings" is a small dataset the team edits, not a rollout → **Cloudflare
KV** (that's exactly what `CUSTOMER_SUCCESS_SERVICE` is).

**Q4. Is it on the render/edit critical path?**
Anything that gates whether/how a diagram renders or the editor works must
keep working when our Cloudflare backend is down (CLAUDE.md: rendering must
not depend on our backend) → **Forge**, mandatory. A KV flag here would
couple rendering to backend availability.

**Q5. Do you need a staged rollout, per-install targeting, or an instant
kill switch for client-side behavior?**
Percentage ramps, "turn it on just for this customer's install", staging-only
enablement, one-click Console kill → **Forge**. This is the default home for
ordinary client-side feature gates.

**Default:** if you reached here it's a plain client-side boolean → **Forge**.

## Guard-rails that can overturn the answer

- **The 10-flag cap.** Each Forge app allows at most 10 flags, and lite is at
  the cap (2026-07-25). A new Forge flag may require retiring an old one
  first. If nothing is retirable and the gate can tolerate backend coupling
  (i.e. it is NOT render-path), KV is the overflow valve.
- **Four apps, four inventories.** A Forge flag exists per app — create it in
  every variant you ship the feature in. If keeping four consoles in sync is
  a real operational burden for your case, weigh KV (one shared backend per
  Pages project).
- **Fail-closed is non-negotiable, both providers.** Missing flag, evaluation
  error, dead backend → today's behavior. Design the gate so "flag
  unavailable" and "flag off" are the same code path (`checkFlag(key, false)`;
  KV fetch errors return `{}`). A flag that fails open is a bug.
- **Latency of the dial.** Forge Console changes apply on the next iframe
  mount (plus any caching the call site adds — the render gate holds a 30-min
  localStorage cache); KV writes apply on the next fetch. Neither needs a
  deploy. If you need sub-minute revocation semantics, neither is suitable —
  that's an entitlement check, see Step 0.

## Worked examples — every current flag, with the deciding question

| Flag | Provider | Deciding question |
|---|---|---|
| `ai-title-enabled`, `ai-repair-enabled`, `agent-link-enabled` | Forge | Q5 — client-side feature gates needing staged rollout + kill switch; boolean; no server read |
| `viewport-gated-render` (#382) | Forge | Q4 — render path; must not depend on our backend |
| `editor-staleness-hint-enabled` | Forge | Q5 — plain client-side UI gate |
| `session-replay`, `session-replay-full` | Forge | Q5 — the rollout **percentage** in the Console is the live sampling rate; per-install targeting does the targeted 100% capture |
| `CUSTOMER_SUCCESS_SERVICE` | Cloudflare KV | Q3 (and Q2) — operator-curated JSON keyed by client domain: the enrolled-tenant list for the Lite paywall |

## Lifecycle rules (the decisions after the provider decision)

- **Adding — Forge:** create the Console flag in each shipped variant (the
  `forge-feature-flag` skill has the workflow; note a new flag's rule
  defaults to dev+staging only — production must be configured explicitly,
  and runtime evidence on a live macro, not the Console header, is the proof
  it's on). Mind the cap.
- **Adding — KV:** new feature names are served by
  `functions/feature-flags.ts`; a new function path must also be added to
  `public/_routes.json` or Pages serves it as SPA HTML.
- **Retiring — Forge, order matters:** remove the code gate and **release
  first**, delete the Console flag second. Deleting first flips a
  live-at-100% flag back to `false` and silently disables a shipped feature.
- **Either provider:** the feature behind the flag still follows the
  analytics-first rule (CLAUDE.md) — plan its Mixpanel events before
  implementing.
