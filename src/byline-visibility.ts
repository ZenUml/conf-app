import api, { getAppContext, route } from '@forge/api';
import {
  emptyTally,
  ensureSpaceProperty,
  formatTally,
  listSpaceIds,
  removeSpaceProperty,
  type SweepTally,
} from './space-properties';

/**
 * Keeps the `byline-enabled` app property in sync with whether this
 * installation should render the Lite byline entry.
 *
 * The property is read by `displayConditions` on `zenuml-byline-diagrams`
 * (manifest.yml). That gate is **fail-closed**: an installation with no
 * property renders no byline. Everything here exists to make sure the property
 * is present and correct, because nothing else can — in particular the byline
 * itself cannot repair it, since a hidden byline is never opened.
 *
 * Why a scheduled function and not the install trigger:
 *
 * - `remote-installed-trigger` forwards to the Cloudflare Remote, and the
 *   Confluence app-properties API is Forge-only. Probed 2026-08-15 with user
 *   basic auth it answers `401
 *   app.property.rest.add_or_delete_on_properties.not_forge_request` — "Missing
 *   OAuth client ID. Was this request sent by a Forge app?". So the backend
 *   cannot write this property no matter how it is authenticated; only
 *   `api.asApp()` from inside a Forge function can.
 * - `avi:forge:upgraded:app` has never produced a ForgeInstallation row in any
 *   of the four apps, despite the trigger subscribing to it. A release
 *   therefore does NOT sweep existing installs, and a scheduled pass is the
 *   only mechanism proven to reach them.
 *
 * CALLER: `byline-visibility-hourly` (manifest.yml `scheduledTrigger`).
 *
 * That trigger existed, was removed while no rollout policy had been decided,
 * and is restored here now that one has. It satisfies the two constraints that
 * are not negotiable for any caller:
 *
 * - It has to be a Forge function, because `asApp()` is the only accepted
 *   caller of this API (see the 401 above).
 * - It cannot be the byline itself. A hidden byline is never opened, so the
 *   surface that needs the property can never be the one that writes it.
 *
 * Hourly rather than daily is about the FIRST write, not the steady state.
 * `scheduledHandler` is idempotent — once an installation's property matches
 * its decision every later tick is a single GET — so the interval only sets how
 * long a newly installed or newly allowlisted site waits with the wrong
 * visibility. A day of that would mean a day of red byline E2E after any deploy
 * to a fresh install.
 *
 * SCOPE: visibility is an explicit cloudId ALLOWLIST (below), materialised as
 * the `zenuml-byline-lite` SPACE property on every space of an enrolled
 * installation — the display condition on zenuml-byline-diagrams reads that
 * space property, not the app property. The both-apps-installed suppression is
 * NOT decided here: the Full app marks its own presence per space
 * (`zenuml-full-active`, src/full-presence.ts) and the manifest condition
 * subtracts it with a `not entityPropertyExists` leg. That replaces the plan
 * doc's D1-with-TTL presence inference, whose input data the doc itself
 * documents as defective (cloudId NULL on most Lite rows, no uninstall event).
 *
 * The `byline-enabled` APP property survives with a demoted job: it is the
 * writer's own last-state marker. A suppressed installation must not pay a
 * full space sweep every hour just to prove there is nothing to clear — the
 * marker says whether a previous tick enrolled this site, so un-enrolment
 * sweeps exactly once and steady-state suppression stays one GET per tick.
 */

const PROPERTY_KEY = 'byline-enabled';

/**
 * Field inside the property object that holds the flag. The app property is
 * now only the writer's marker, but the SPACE property below reuses the same
 * `{enabled: "..."}` shape, and there `objectName: enabled` on the
 * zenuml-byline-diagrams display condition depends on it — the condition
 * evaluates false when the path is absent, so a rename on one side alone hides
 * the byline everywhere and says nothing about why.
 */
const PROPERTY_FIELD = 'enabled';

/**
 * The space property the display condition actually reads. Same object shape
 * as the app property deliberately: `{enabled:"true"}` + `objectName` is the
 * one encoding that has been PROVEN to satisfy entityPropertyEqualTo on this
 * surface (staging, 2026-08-15), and the string-vs-object conversion semantics
 * of a bare value is exactly where this feature failed twice before.
 */
export const SPACE_PROP_KEY = 'zenuml-byline-lite';
const SPACE_PROP_VALUE = { [PROPERTY_FIELD]: 'true' };

/**
 * Built as a literal template. NOT `route`${path}`` — `route` percent-encodes
 * its interpolations, so passing a whole path escapes the slashes into one
 * nonsense segment.
 */
const PROP_ROUTE = route`/wiki/api/v2/app/properties/byline-enabled`;

/**
 * The property value, and the `value:` in the manifest display condition, are
 * both the STRING "true" rather than a boolean. That is forced, not stylistic:
 * `forge lint` rejects a boolean there outright —
 *   Display conditions of "zenuml-byline-diagrams" are invalid.
 *   "value" property must be string.
 * so a boolean in the property could never match the condition it exists for.
 */
export const VISIBLE = 'true';
export const HIDDEN = 'false';

const L = '[byline-visibility]';

/**
 * Reasons are drawn from the `byline_visibility_reason` union already
 * registered in src/utils/analytics/types.ts, rather than invented here. Two
 * consequences worth stating: the values stay low-cardinality (a per-site
 * reason string would make the property useless to group by), and the moment
 * these decisions are wired to trackAnalyticsEvent they type-check without a
 * translation layer.
 */
export type VisibilityReason = 'enrolled' | 'not_enrolled' | 'no_signal';

export type Decision = {
  value: string;
  decision: 'visible' | 'suppressed';
  reason: VisibilityReason;
  /** Allowlist entry that matched, for logs only — never an analytics property. */
  site?: string;
};

/**
 * Sites that render the Lite byline, by cloudId.
 *
 * Both are our own — the Lite E2E target and a developer site — not customer
 * tenants, which is what makes naming them here compatible with
 * docs/policies/client-privacy.md. `lite-stg.atlassian.net` is already named in
 * tests/e2e-tests/config/apps.ts for the same reason.
 *
 * cloudIds read from each site's /_edge/tenant_info on 2026-08-15. Matching on
 * cloudId rather than hostname because that is what the runtime actually hands
 * us (`installation.contexts[].cloudId`); a hostname would have to be resolved
 * by a further request that could fail, on the fail-closed side of the gate.
 */
export const ALLOWLIST: ReadonlyMap<string, string> = new Map([
  ['c78e721e-957f-402c-9b70-1df2227c2739', 'lite-stg.atlassian.net'],
  ['866c3a03-ec62-4717-91c4-1ad078bfcc60', 'whimet4.atlassian.net'],
]);

/**
 * The cloudId of the installation this invocation is running for.
 *
 * `contexts` is an array and every entry's `cloudId` is optional in the SDK
 * types, so this takes the first one that is present rather than indexing [0]
 * and trusting it. A Confluence installation has exactly one, but the type
 * permits neither assumption, and guessing wrong here silently allowlists or
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
 * Allowlist rollout. Kept as a named seam so Phase 2 swaps one function rather
 * than restructuring the handler around it.
 *
 * An unresolvable cloudId is SUPPRESSED, not visible. "We could not tell which
 * site this is" has to fall on the same side as "this site is not enrolled",
 * because the whole point of a fail-closed gate is that uncertainty hides the
 * surface rather than exposing it.
 */
export function decide(cloudId: string | undefined): Decision {
  if (!cloudId) {
    return { value: HIDDEN, decision: 'suppressed', reason: 'no_signal' };
  }
  const site = ALLOWLIST.get(cloudId);
  if (!site) {
    return { value: HIDDEN, decision: 'suppressed', reason: 'not_enrolled' };
  }
  return { value: VISIBLE, decision: 'visible', reason: 'enrolled', site };
}

/**
 * `getAppContext()` throws outside an invocation context. Catching keeps that
 * failure on the fail-closed path instead of killing the tick.
 */
function readCloudId(): string | undefined {
  try {
    return currentCloudId(getAppContext());
  } catch {
    return undefined;
  }
}

async function readCurrent(): Promise<{ value?: string; status: number }> {
  const res = await api.asApp().requestConfluence(PROP_ROUTE);
  if (!res.ok) return { status: res.status };
  // Text, then parse: a non-JSON body on an unexpected status would otherwise
  // throw here and lose the status code, which is the useful part.
  const body = await res.text().catch(() => '');
  try {
    const parsed = JSON.parse(body);
    // The GET envelope is `{key, value}`, so `parsed.value` is the stored
    // value — an OBJECT, and the flag lives at PROPERTY_FIELD inside it (see
    // `write`). Read as a string only when it actually is one, so that every
    // shape this key has ever held — absent, a bare string, or the
    // double-wrapped `{key, value}` from the original writer — reads as
    // undefined and triggers a corrective write rather than comparing equal to
    // nothing forever.
    const field = parsed?.value?.[PROPERTY_FIELD];
    return { value: typeof field === 'string' ? field : undefined, status: res.status };
  } catch {
    return { status: res.status };
  }
}

/**
 * Write the property as a JSON OBJECT carrying the flag at `PROPERTY_FIELD`.
 *
 * Two constraints meet here, and only this shape satisfies both.
 *
 * The endpoint takes the ENTIRE request body as the property value, so an
 * envelope gets stored verbatim and nests — observed on whimet4 2026-08-15, a
 * PUT of `{"key":"byline-enabled","value":"true"}` read back as
 *   {"key":"byline-enabled","value":{"key":"byline-enabled","value":"true"}}
 * which answered 200 while leaving a value no condition could match.
 *
 * The obvious correction — PUT the bare string `"true"` — is rejected. The v2
 * app-properties reference types the request body as `object` (its example is
 * `{ "name": "Forge app", "darkMode": true, ... }`), and a bare JSON scalar
 * answers 400 on CREATE. That failure was invisible in the whimet4 spike
 * because the property already existed there, so the spike only ever exercised
 * an UPDATE. Confirmed against a fresh installation in the staging logs
 * 2026-08-15T04:34Z — full-stg, `current status=404` then
 * `write result=failed status=400`.
 *
 * So the value is an object, and the display condition reaches into it with
 * `objectName: enabled` (manifest.yml). PUT is correct for both create and
 * update — the reference documents one endpoint answering 201 Created or
 * 200 OK — and no `version.number` is needed for either.
 */
async function write(value: string): Promise<{ ok: boolean; status: number; body: string }> {
  const res = await api.asApp().requestConfluence(PROP_ROUTE, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ [PROPERTY_FIELD]: value }),
  });
  // The response body is read on failure because the status alone is what made
  // the 400 above take a deployment to understand: 'failed status=400' does not
  // say whether the body shape, the route, or the scope was wrong.
  const body = res.ok ? '' : await res.text().catch(() => '');
  return { ok: res.ok, status: res.status, body };
}

/** Ensure the marker app property reads `target`, read-back verified. */
async function settleMarker(target: string): Promise<boolean> {
  const current = await readCurrent();
  if (current.value === target) return true;
  const res = await write(target);
  const after = await readCurrent();
  const settled = after.value === target;
  if (!res.ok || !settled) {
    console.log(
      `${L} marker write failed status=${res.status} readback=${String(after.value)}` +
        `${res.body ? ` body=${res.body.slice(0, 300)}` : ''}`,
    );
  }
  return settled;
}

export async function scheduledHandler() {
  const cloudId = readCloudId();
  const { value: target, decision, reason, site } = decide(cloudId);
  console.log(
    `${L} evaluated cloudId=${cloudId ?? 'unknown'} site=${site ?? '-'} ` +
      `decision=${decision} reason=${reason} target=${target}`,
  );

  if (target === VISIBLE) {
    // Enrolled: every space carries the property the display condition reads.
    // Sweep first, marker second — the marker asserts "spaces are enrolled",
    // so it must never be set by a tick that died mid-sweep.
    const tally = await sweep((spaceId) => ensureSpaceProperty(spaceId, SPACE_PROP_KEY, SPACE_PROP_VALUE));
    const markerSettled = tally.failed === 0 ? await settleMarker(VISIBLE) : false;
    console.log(
      `${L} write result=${tally.failed > 0 || !markerSettled ? 'failed' : tally.created + tally.updated > 0 ? 'written' : 'unchanged'} ${formatTally(tally)} marker=${markerSettled}`,
    );
    return;
  }

  // Suppressed: absence is the hidden state, so there is nothing to write —
  // UNLESS a previous tick enrolled this site, which is what the marker
  // remembers. Then the space properties must be swept away exactly once.
  const current = await readCurrent();
  console.log(`${L} current status=${current.status} marker=${String(current.value)}`);
  if (current.value !== VISIBLE) {
    console.log(`${L} write result=unchanged`);
    return;
  }
  const tally = await sweep((spaceId) => removeSpaceProperty(spaceId, SPACE_PROP_KEY));
  // Marker clears only after a clean sweep, so a partial clear retries next
  // tick instead of stranding stale `enabled:"true"` properties forever.
  const markerSettled = tally.failed === 0 ? await settleMarker(HIDDEN) : false;
  console.log(
    `${L} write result=${tally.failed > 0 || !markerSettled ? 'failed' : 'cleared'} ${formatTally(tally)} marker=${markerSettled}`,
  );
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
