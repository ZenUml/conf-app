import api, { getAppContext, route } from '@forge/api';

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
 * SCOPE, this change: visibility is an explicit cloudId ALLOWLIST (below).
 * Every other installation is written HIDDEN. The both-apps-installed
 * suppression remains Phase 2 of
 * docs/superpowers/plans/2026-08-15-byline-visibility-app-property.md and lands
 * as a Remote call inside `decide()`.
 */

const PROPERTY_KEY = 'byline-enabled';

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
    // The GET envelope is `{key, value}`, so `parsed.value` IS the stored
    // value. Compared as a string only when it actually is one: a legacy
    // double-wrapped property (see `write`) parses to an OBJECT here, and
    // `String()`-ing it produced "[object Object]" — which never equals the
    // target, so the writer rewrote on every single run and `unchanged` was
    // unreachable. Anything non-string is reported as undefined instead, which
    // reads as "no usable value" and correctly triggers a corrective write.
    const value = typeof parsed?.value === 'string' ? parsed.value : undefined;
    return { value, status: res.status };
  } catch {
    return { status: res.status };
  }
}

/**
 * Write the property, tolerating either versioning contract.
 *
 * The v2 app-properties docs describe the PUT body as "an object containing the
 * property value" and say nothing about versions, but sibling Confluence
 * property APIs require `version.number` on update and answer 409 without it.
 * Rather than guess, try the bare body and escalate only on rejection — so the
 * first real deployment settles the question in its logs instead of failing
 * every update after a create that looked healthy.
 */
async function write(value: string): Promise<{ ok: boolean; status: number }> {
  const res = await api.asApp().requestConfluence(PROP_ROUTE, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    // The BARE value, not `{key, value}`. This endpoint takes the entire
    // request body AS the property value, so an envelope gets stored verbatim
    // and nests: observed on whimet4 2026-08-15, a PUT of
    // `{"key":"byline-enabled","value":"true"}` read back as
    //   {"key":"byline-enabled","value":{"key":"byline-enabled","value":"true"}}
    // The write answered 200 and the property existed, but its value was an
    // OBJECT — so `entityPropertyEqualTo: value: "true"` could never match and
    // the byline stayed hidden. A successful status here does not mean the gate
    // will open; only the read-back shape proves that.
    body: JSON.stringify(value),
  });
  return { ok: res.ok, status: res.status };
}

export async function scheduledHandler() {
  const cloudId = readCloudId();
  const { value: target, decision, reason, site } = decide(cloudId);
  console.log(
    `${L} evaluated cloudId=${cloudId ?? 'unknown'} site=${site ?? '-'} ` +
      `decision=${decision} reason=${reason} target=${target}`,
  );

  const current = await readCurrent();
  console.log(`${L} current status=${current.status} value=${String(current.value)}`);

  // Idempotence is not a micro-optimisation here: without it every tick writes,
  // which burns a request per install per hour and makes 'unchanged' — the
  // expected steady state — unobservable.
  if (current.value === target) {
    console.log(`${L} write result=unchanged`);
    return;
  }

  const res = await write(target);
  // Read back rather than trusting the status. A 200 here only says the request
  // was accepted; it does NOT say the stored value has the shape the display
  // condition compares against — which is exactly how the double-wrapped write
  // reported success while the byline stayed hidden.
  const after = await readCurrent();
  const settled = after.value === target;
  console.log(
    `${L} write result=${!res.ok ? 'failed' : settled ? (target === VISIBLE ? 'written' : 'cleared') : 'failed'} ` +
      `status=${res.status} readback=${String(after.value)} settled=${settled}`,
  );
}
