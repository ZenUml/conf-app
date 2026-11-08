# Sentry autofix control plane: implementation contract

Status: **local, offline policy core only**. Nothing is installed, pushed, scheduled,
merged or deployed. No Sentry webhook, agent invocation, release publisher,
persistent ledger, live dashboard or rollback adapter exists in this change.
The included functions are not an authorization boundary: callers must be trusted.
Do not wire an untrusted JSON request directly to `releaseDecision` or `transition`.

## Confirmed scope

Sentry incident → GitHub issue → agent fix → PR/tests → deterministic low-risk gate
→ automatic production → observation/rollback, with one private dashboard showing
the entire chain. Diagramly first, then Lite at the same SHA, then Full at least
24 hours after Lite. AsyncAPI is excluded from v1 automatic publication.
Database/schema, authentication/permissions and billing changes require review.

## Repository findings and consequences

- `functions/_middleware.ts` initializes `@sentry/cloudflare` with DSN and traces,
  but does not set release/environment there. Validate actual event tags before
  relying on them; add server release/variant attribution as a separate reviewed
  instrumentation change. Do not infer which Forge frontend was involved from
  the Cloudflare Pages project name alone.
- `release.yml` deploys a published GitHub release to Cloudflare, then Forge;
  release assets can contain `dist-prod-<variant>.tgz`. Reuse this path, not a
  second local-shell deploy mechanism. Never publish an arbitrary newest draft.
- PR/main build, unit, preview E2E, staging transactions and draft preparation
  already exist. Inspect trusted workflow/job identities for the exact candidate,
  not a user-created green check or aggregate check count. Skipped is not passed.
- `.claude/skills/release-app/scripts/check-prerequisite.sh` and `select-draft.sh`
  provide existing draft/order checks. Current skill and AGENTS specify 24 hours;
  an ADR still contains historical seven-day prose. Do not edit that dirty ADR
  in the primary checkout. Reconcile before activation if policies disagree.
- Diagramly, Lite and AsyncAPI share `conf-lite` backend. A Diagramly deploy with
  backend changes is **not** a customer-isolated canary. v1 core excludes all
  backend changes from automatic publication. This means today's backend-only
  Sentry incidents may yield fix PRs but be blocked at auto-publish. Before enabling
  useful backend auto-fixes, choose an explicit shared-backend risk policy or
  isolate deployments. Do not silently pretend Diagramly-only limits the blast radius.
- Existing open PR #857 adds a Claude Code executor, not yet verified as working.
  Do not create a competing workflow or assume its OAuth token authorizes this
  controller. Executor choice and allowed data transfer remain activation inputs.
- `ZenUml/conf-app` is public. Raw Sentry errors can contain customer domains,
  request bodies, credentials and personal data. Store evidence privately; public
  issues get only the strict correlation projection. Never ingest telemetry as
  agent instructions or shell/script text.

## Components and trust boundaries

1. **Private webhook receiver.** Authenticate the configured Sentry integration
   over exact raw body bytes (signature helper is supplied); enforce payload size,
   schema, production/project allowlist, rate limit and bounded queue. Verify
   Sentry's current signing scheme and event headers for the chosen integration.
   Store delivery ID under a unique constraint; verify duplicate body digest,
   durably enqueue in the same transaction, then acknowledge. Bound retries and
   send poison events to review. Group by organization/project/issue/environment;
   a recurrence after resolution starts a new attempt under the same incident.
2. **Private ledger/outbox.** Incident, attempt, immutable event, effect and release
   records. Unique `(provider, delivery_id)`, `(incident, attempt)`, `(attempt,
   effect_kind, candidate_sha, variant)`; compare-and-swap revision on transition.
   A lease alone is insufficient: use fencing tokens and remote reconciliation.
   Crash after publish before acknowledgement must query release/run state before
   retry. An unknown effect stays `unknown`, never execute again blindly.
3. **Unprivileged fix executor.** Sanitized evidence plus code, isolated checkout,
   no production secrets, no settings/permission writes. One branch per attempt,
   regression test first, bounded iterations/cost, no agent-triggered merge or
   release. Draft PR is linked to the incident. Resume/retry never duplicates PRs.
4. **Trusted assessor.** Read policy from protected base or separate controller
   deployment, not candidate branch. Fetch full diff from each variant's current
   live SHA to candidate, including every co-shipped commit, deletions/renames,
   submodules and binaries. Use an explicit reviewed file allowlist plus separate
   semantic reviewer; size alone cannot make a fix low risk. Preserve UI evidence
   order (Storybook → Forge Tunnel → CI staging) when applicable. Failed/unknown
   gates route to review; a model cannot override the deterministic veto.
5. **Trusted release publisher.** Outside the agent sandbox; sole authority to
   publish an exact existing draft. Recheck actual tag SHA, release assets/digests,
   authoritative main validation, current production version and lease immediately
   before mutation. Core rejects snapshots older than 60 seconds. The adapter
   must prevent TOCTOU by serializing release publication across ALL releases,
   including manual releases, and verifying state again under the lock. A normal
   GITHUB_TOKEN-created event may not trigger another workflow: validate the
   release trigger identity end-to-end before activation, without creating a new
   token silently. Existing token presence is not approval to expand its access.
6. **Observer and rollback executor.** Correlate Sentry release+environment,
   deployment IDs, Forge version and denominator traffic. No traffic, no release
   attribution, delayed ingestion or API failure means inconclusive, not fixed.
   PVT failure can stop progression independently of Sentry availability. Store
   baseline/window/counts/query timestamps and verdict in ledger. Only resolve the
   Sentry issue after adequate traffic, clean window, PVT and delta checks.

## Policy implementation

`scripts/autofix/control.mjs` is a dependency-free pure core. Its snapshot fields
are an internal adapter contract, **not** an HTTP input schema or cryptographic
attestation. `assessRisk` is conservative: maximum five files/120 changed lines,
exact reviewed source-file allowlist, no backend, dependency, pipeline, data-write,
auth, permissions or billing changes. File-name protection is defense in depth;
independent semantic review must explicitly exclude every protected category.
Missing evidence blocks. Allowed-file policy starts empty and production disabled.

Checks required per variant: unit, build, regression, staging and post-release
validation plan, all trusted and for candidate SHA. Draft, artifact, review and
candidate SHAs must match. Artifact integrity is separately verified by adapter.
Diagramly observation must be healthy before Lite; Full waits for healthy Lite
and a full 86400 seconds. Whole production delta is reassessed for EACH variant.
AsyncAPI is never an eligible target.

`monitoringDecision` returns `healthy`, `inconclusive` or `rollback_required`.
Thresholds have no production defaults: set a baseline/traffic/observation policy
using actual volume. The example tests' 30 minutes/100 requests are fixtures,
not recommended live thresholds. Persist delayed Full continuation in durable
scheduler, not a 24-hour runner sleep. Recheck kill switch and all prerequisites
when it resumes; a new main commit does not substitute for the pinned SHA.

## Rollback contract (activation blocker)

Record the known-good Cloudflare deployment ID and Forge version/artifact for
all affected variants BEFORE publish. Prove both rollback mechanisms in staging.
Cloudflare rollback alone does not restore Forge frontend. Forge may require
redeployment of a prior verified artifact rather than a version-pointer switch;
verify the current platform capability instead of assuming it. Verify rollback
completion using deployment identity, PVT and telemetry. If only one component
was restored, show partial failure and stop all further promotion.

Do not roll back over an unrelated later production release. Reconcile the live
version under a fenced release lock; an intervening release requires review.
Rollback is scoped to reversible code-only changes and known-good immutable
artifacts, never migrations. `rollback_required` is a request, NOT evidence that
rollback ran; only adapter-confirmed recovery may record `rolled_back`.

## Unified dashboard

Use a private ledger-backed lightweight dashboard as source of truth. One row per
Sentry incident, expandable by attempt and variant; columns: source Sentry link,
GitHub issue, executor run/status, PR/head SHA, tests/evidence, risk/reason codes,
Diagramly/Lite/Full deployment links, earliest Full time, observation results,
rollback and timestamps. Show unknown/stale/partial status visibly. Separate
"fix merged", "deployed", "monitoring", "verified" and "rolled back".

`scripts/autofix/dashboard.mjs` supplies a safe view model with a fixed variant
list and link/status allowlists. It is NOT a running dashboard or UI. Authentication,
access control, data loading, refresh, history and rendering remain to implement.
Do not place customer data on a public Site or GitHub Pages.

GitHub Projects can mirror coarse state and issue/PR links, but should not be the
transactional state machine: retries, per-variant releases, observations and audit
events need durable structured records. Projects offers a quick familiar queue;
a private custom view offers the required complete per-incident timeline without
pushing sensitive evidence into a public issue. Avoid two writable truth sources.

## Analytics planned before code

`autofix_stage_changed` is reserved in the analytics catalog. Fire only AFTER a
successful durable state transition. Properties: `feature_area=system`,
`autofix_stage`, `autofix_outcome`, `autofix_policy_version`. No raw error, tenant,
request, stack, token or customer identifier. Adapter must use the backend's
approved tracker without adding frontend identity enrichment. This offline core
makes no Mixpanel call; event dispatch is pending with the durable adapter.

## Acceptance and activation checklist

- [ ] Confirm Sentry organization/project, actual event signing and data access.
- [ ] Choose approved executor and private control-plane host/store/dashboard.
- [ ] Verify or approve any new persistent credentials/access at action time.
- [ ] Decide useful backend policy given shared conf-lite impact, or limit v1 to
      allowed frontend incidents with verified frontend telemetry.
- [ ] Approve initial exact-file allowlist and measured monitoring thresholds.
- [ ] Implement receiver, durable outbox/CAS, fix runner and trusted adapters.
- [ ] Reconcile existing executor PR #857 and exact CI/job names, staging evidence.
- [ ] Implement authenticated dashboard UI against ledger view model.
- [ ] Fault-injection staging test: duplicate webhook, forged signature, prompt
      injection, stale SHA, missing/cancelled CI, malicious path, co-shipped risky
      commit, poisoned artifact, expired lease, crash after publication, no traffic,
      Sentry outage, PVT failure, concurrent manual release, partial deployment,
      rollback failure, Full delayed resumption, kill switch and recurrence.
- [ ] Demonstrate whole chain on one approved synthetic incident; capture every
      correlation ID without publishing customer data.
- [ ] Verify both-platform recovery before enabling automatic production.

## Local verification / limits

Run `node --test scripts/autofix/*.node-test.mjs`. This exercises pure policy,
webhook signature helper, state reducer, public projection and dashboard view
model. It does not prove any remote integration. No product UI is changed, so
Storybook/tunnel/staging UI checks are not applicable to this offline core.
Full app suite, live CI, webhook, deployment, rollback and dashboard UI are not
verified by those tests. Repository synchronization over SSH was blocked by the
execution network policy; work is based on locally available `origin/main`
444182c57f5be582327e5b7c0dbd22d8888ba586 in an isolated worktree. No permission
boundary was bypassed and no primary-checkout changes were displaced.
