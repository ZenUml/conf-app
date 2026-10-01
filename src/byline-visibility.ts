import api, { getAppContext, route, storage } from '@forge/api';
import { FeatureFlags } from '@forge/feature-flags';
import {
  emptyTally,
  ensureSpaceProperty,
  formatTally,
  listSpaceIds,
  removeSpaceProperty,
  type SweepTally,
} from './space-properties';

/**
 * Keeps the per-space `zenuml-byline*` enrolment property in sync with whether
 * this installation should render the Lite byline entry.
 *
 * The property is read by `displayConditions` on `zenuml-byline-diagrams`
 * (manifest.yml). That gate is **fail-closed**: a space with no property
 * renders no byline. Everything here exists to make sure the property is
 * present and correct on every space, because nothing else can — in
 * particular the byline itself cannot repair it, since a hidden byline is
 * never opened.
 *
 * CALLER: `byline-visibility-hourly` (legacy trigger key in manifest.yml),
 * Lite-only, now daily. The independent Forge flag controls this background
 * work and does not change the byline display condition itself.
 *
 * SCOPE: every installation whose cloudId the runtime can resolve, materialised
 * as the enrolment space property on every space of that installation. An
 * unresolvable cloudId still suppresses — see `decide`. (Through 2026-08-22
 * this was an explicit two-site cloudId allowlist, removed with the rollout.)
 * The both-apps-installed suppression is NOT decided here: the Full app marks
 * its own presence per space (`zenuml-full-active`, src/full-presence.ts) and
 * the manifest condition subtracts it with a `not entityPropertyExists` leg.
 *
 * COST: enabled installs run one full pass per day. Disabled or unavailable
 * flags leave all existing properties and the storage marker untouched.
 * Watch Forge Functions GB-seconds after this ships; see the
 * forge-functions-cost skill.
 *
 * STATE MARKER: whether a previous tick enrolled this site is remembered in
 * Forge app storage (`storage:app` scope, already granted), NOT in a
 * Confluence property. The original suppressed-state cleanup path remains
 * below, but an invocation without a cloudId cannot evaluate the new
 * site-scoped flag and skips before reaching it. A disabled flag never uses
 * that cleanup path: it preserves the existing property and marker. The
 * vestigial `byline-enabled` app property is deleted only on a successful
 * state transition — see `deleteLegacyAppProperty`.
 */

/**
 * Field inside the space property object that holds the flag. `objectName:
 * enabled` on the zenuml-byline-diagrams display condition depends on it — the
 * condition evaluates false when the path is absent, so a rename on one side
 * alone hides the byline everywhere and says nothing about why. The object
 * shape (rather than a bare value) is the one encoding PROVEN to satisfy
 * entityPropertyEqualTo on this surface; bare-value string conversion is where
 * this gate failed twice before.
 */
const PROPERTY_FIELD = 'enabled';
const SPACE_PROP_VALUE = { [PROPERTY_FIELD]: 'true' };

/**
 * The manifest templates the property key per variant:
 * `zenuml-byline${LITE_KEY_SUFFIX}` (manifest.yml, zenuml-byline-diagrams).
 * The writer cannot read that template — no evidence exists that manifest
 * environment variables reach the function runtime — so it derives the same
 * key from the one fact the runtime does hand it: which app it is running in.
 *
 * appId → suffix mirrors APPS in scripts/forge-wizard.mjs (the source of
 * truth for both values), and tests/unit/bylineKeyConsistency.spec.ts pins
 * code, wizard, and manifest template to each other — a drift in any of the
 * three fails the suite rather than silently hiding the byline.
 */
export const SPACE_PROP_BASE = 'zenuml-byline';
export const APP_SPACE_KEY_SUFFIXES: ReadonlyMap<string, string> = new Map([
  ['8ad26115-211f-4216-971b-0540f606303d', '-lite'], // lite
  ['d9e4002b-120b-426b-834b-402a4a5adce7', ''], // full
  ['01ede8b1-4e88-451a-b9ef-89eeef93afaf', ''], // diagramly
  ['49017727-af19-4ab6-8d5a-7d28108936b6', ''], // asyncapi
]);

/**
 * The enrolment property key for the app this invocation runs in, or
 * undefined for an app not in the map — in which case the caller must write
 * NOTHING: a wrong key would satisfy no display condition (silently hidden,
 * fail-closed) but would still litter every space with junk properties.
 */
export function spacePropertyKey(appId: string | undefined): string | undefined {
  if (!appId) return undefined;
  const suffix = APP_SPACE_KEY_SUFFIXES.get(appId);
  if (suffix === undefined) return undefined;
  return `${SPACE_PROP_BASE}${suffix}`;
}

/**
 * The property value, and the `value:` in the manifest display condition, are
 * both the STRING "true" rather than a boolean. That is forced, not stylistic:
 * `forge lint` rejects a boolean there outright, so a boolean in the property
 * could never match the condition it exists for.
 */
export const VISIBLE = 'true';
export const HIDDEN = 'false';
export const BYLINE_RECONCILIATION_FLAG = 'byline-reconciliation-enabled';

const L = '[byline-visibility]';

/**
 * Forge storage key remembering the last settled state of this installation:
 * 'enrolled' (spaces carry the property) or 'clean' (they verifiably do not).
 * Absent means unknown — e.g. first tick after this code deploys — and reads
 * as not-settled, so the handler converges with one sweep.
 */
const STATE_KEY = 'byline-visibility-state';
type SettledState = 'enrolled' | 'clean';

async function readState(): Promise<SettledState | undefined> {
  try {
    const v = await storage.get(STATE_KEY);
    return v === 'enrolled' || v === 'clean' ? v : undefined;
  } catch {
    // Unknown state degrades to an extra sweep, never to a wrong gate.
    return undefined;
  }
}

async function writeState(state: SettledState): Promise<void> {
  try {
    await storage.set(STATE_KEY, state);
  } catch {
    // Next tick re-converges; the sweep it repeats is idempotent.
  }
}

/**
 * The `byline-enabled` APP property was the previous gate mechanism and then
 * briefly the writer's marker; nothing reads it anymore. Deleted on each state
 * transition rather than on every tick — transitions are rare, and after the
 * first one this is a no-op 404 that never runs again for the installation.
 */
async function deleteLegacyAppProperty(): Promise<void> {
  const res = await api
    .asApp()
    .requestConfluence(route`/wiki/api/v2/app/properties/byline-enabled`, { method: 'DELETE' })
    .catch(() => undefined);
  if (res && !res.ok && res.status !== 404) {
    console.log(`${L} legacy app property delete failed status=${res.status}`);
  }
}

/**
 * Reasons are drawn from the `byline_visibility_reason` union already
 * registered in src/utils/analytics/types.ts, rather than invented here — the
 * values stay low-cardinality (a per-site reason string would make the
 * property useless to group by). There is no `byline_visibility_evaluated` /
 * `byline_visibility_write` catalog entry to wire this into: those names were
 * deleted 2026-09-02 as unwired instrumentation (zero trackAnalyticsEvent
 * callers). This writer remains fail-closed and unobserved — see
 * DECISIONS-FOR-USER.md.
 */
export type VisibilityReason = 'enrolled' | 'not_enrolled' | 'no_signal';

export type Decision = {
  value: string;
  decision: 'visible' | 'suppressed';
  reason: VisibilityReason;
};

/**
 * The cloudId of the installation this invocation is running for.
 *
 * `contexts` is an array and every entry's `cloudId` is optional in the SDK
 * types, so this takes the first one that is present rather than indexing [0]
 * and trusting it. A Confluence installation has exactly one, but the type
 * permits neither assumption, and guessing wrong here silently enrols or
 * silently hides.
 */
export function currentCloudId(context: {
  installation?: { contexts?: ReadonlyArray<{ cloudId?: string }> };
}): string | undefined {
  for (const c of context.installation?.contexts ?? []) {
    if (c.cloudId) return c.cloudId;
  }
  return undefined;
}

/**
 * General rollout: every installation the runtime can identify renders the
 * byline. This is the Phase 2 swap the allowlist stage was built to allow —
 * one function changes, the handler around it does not. (Through 2026-08-22
 * this consulted a two-site cloudId allowlist; `git log` has it if a
 * re-restriction is ever needed.)
 *
 * An unresolvable cloudId is still SUPPRESSED. That leg is not about rollout
 * scope and does not relax with it: the property write is keyed to a specific
 * installation, so "we could not tell which site this is" means there is
 * nothing safe to write. It is now the only suppressing input, which is what
 * keeps the gate falsifiable.
 *
 * Note this widens only the enrolment leg of the manifest condition. The
 * both-apps-installed suppression is independent and still applies: Full marks
 * `zenuml-full-active` per space (src/full-presence.ts) and the condition
 * subtracts it, so a site carrying both apps keeps the Lite byline dark.
 */
export function decide(cloudId: string | undefined): Decision {
  if (!cloudId) {
    return { value: HIDDEN, decision: 'suppressed', reason: 'no_signal' };
  }
  return { value: VISIBLE, decision: 'visible', reason: 'enrolled' };
}

/** `getAppContext()` throws outside an invocation context; degrade to unknown. */
function readContext(): { cloudId?: string; appId?: string } {
  try {
    const ctx = getAppContext();
    return { cloudId: currentCloudId(ctx), appId: ctx.appAri?.appId };
  } catch {
    return {};
  }
}

/** A missing/failed flag skips the scan and never edits visibility state. */
export async function isReconciliationEnabled(cloudId: string | undefined): Promise<boolean> {
  if (!cloudId) return false;
  const client = new FeatureFlags();
  try {
    const environment = String(getAppContext().environmentType ?? 'development').toLowerCase();
    if (environment !== 'development' && environment !== 'staging' && environment !== 'production') {
      return false;
    }
    await client.initialize({ environment });
    const installContext = `ari:cloud:confluence::site/${cloudId}`;
    return client.checkFlag(
      { identifiers: { installContext }, attributes: { installContext } },
      BYLINE_RECONCILIATION_FLAG,
      false,
    );
  } catch (error) {
    console.log(`${L} reconciliation flag unavailable: ${error instanceof Error ? error.name : 'unknown'}`);
    return false;
  } finally {
    client.shutdown();
  }
}

type RunOutcome = 'skipped' | 'unchanged' | 'changed' | 'failed';
type RunSummary = { outcome: RunOutcome; tally: SweepTally };

/** Forge logs are also the start signal if a hard timeout prevents completion. */
async function reportRun(started: number, runId: string, summary: RunSummary): Promise<void> {
  const durationMs = Date.now() - started;
  const changed = summary.tally.created + summary.tally.updated + summary.tally.deleted;
  console.log(`${L} run completed ${JSON.stringify({
    runId,
    outcome: summary.outcome,
    durationMs,
    spaceCount: summary.tally.spaces,
    changedCount: changed,
    failureCount: summary.tally.failed,
  })}`);
}

export async function scheduledHandler() {
  const started = Date.now();
  const runId = crypto.randomUUID();
  console.log(`${L} run started runId=${runId}`);
  let summary: RunSummary = { outcome: 'failed', tally: emptyTally() };
  try {
    summary = await reconcile();
  } catch (error) {
    summary.tally.failed = 1;
    console.log(`${L} unexpected failure runId=${runId} reason=${error instanceof Error ? error.name : 'unknown'}`);
  }
  await reportRun(started, runId, summary);
}

async function reconcile(): Promise<RunSummary> {
  const { cloudId, appId } = readContext();
  if (!(await isReconciliationEnabled(cloudId))) {
    console.log(`${L} scan skipped flag=off_or_unavailable`);
    return { outcome: 'skipped', tally: emptyTally() };
  }
  const { value: target, decision, reason } = decide(cloudId);
  console.log(
    `${L} evaluated cloudId=${cloudId ?? 'unknown'} ` +
      `decision=${decision} reason=${reason} target=${target}`,
  );

  const key = spacePropertyKey(appId);
  if (!key) {
    console.log(`${L} write result=failed appId=${appId ?? 'unknown'} — no property key mapping, writing nothing`);
    return { outcome: 'failed', tally: { ...emptyTally(), failed: 1 } };
  }

  const state = await readState();

  if (target === VISIBLE) {
    // Enrolled: every space carries the property the display condition reads.
    // Sweep first, marker second — the marker asserts "spaces are enrolled",
    // so it must never be set by a tick that died mid-sweep.
    const tally = await sweep((spaceId) => ensureSpaceProperty(spaceId, key, SPACE_PROP_VALUE));
    if (tally.failed === 0 && state !== 'enrolled') {
      await writeState('enrolled');
      await deleteLegacyAppProperty();
    }
    console.log(
      `${L} write result=${tally.failed > 0 ? 'failed' : tally.created + tally.updated > 0 ? 'written' : 'unchanged'} ${formatTally(tally)}`,
    );
    return { outcome: tally.failed > 0 ? 'failed' : tally.created + tally.updated > 0 ? 'changed' : 'unchanged', tally };
  }

  // Suppressed: absence is the hidden state, so there is nothing to write —
  // unless the installation is not KNOWN to be clean (a previous tick enrolled
  // it, or the state is unknown, e.g. right after this code first deploys).
  // Then the space properties are swept away exactly once, and the marker
  // clears only after a clean sweep so a partial clear retries next tick
  // instead of stranding stale `enabled:"true"` properties forever.
  if (state === 'clean') {
    console.log(`${L} write result=unchanged state=clean`);
    return { outcome: 'unchanged', tally: emptyTally() };
  }
  const tally = await sweep((spaceId) => removeSpaceProperty(spaceId, key));
  if (tally.failed === 0) {
    await writeState('clean');
    await deleteLegacyAppProperty();
  }
  console.log(
    `${L} write result=${tally.failed > 0 ? 'failed' : 'cleared'} ${formatTally(tally)}`,
  );
  return { outcome: tally.failed > 0 ? 'failed' : tally.deleted > 0 ? 'changed' : 'unchanged', tally };
}

/** Run `perSpace` over every space on the site, tallying outcomes. */
async function sweep(
  perSpace: (spaceId: string) => Promise<'created' | 'updated' | 'unchanged' | 'deleted' | 'absent' | 'failed'>,
): Promise<SweepTally> {
  const tally = emptyTally();
  let spaceIds: string[];
  try {
    spaceIds = await listSpaceIds();
  } catch (e) {
    console.log(`${L} sweep aborted: ${e instanceof Error ? e.message : String(e)}`);
    tally.failed += 1;
    return tally;
  }
  tally.spaces = spaceIds.length;
  for (const spaceId of spaceIds) {
    const outcome = await perSpace(spaceId).catch(() => 'failed' as const);
    tally[outcome] += 1;
  }
  return tally;
}
