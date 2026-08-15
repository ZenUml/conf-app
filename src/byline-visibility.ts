import api, { route } from '@forge/api';

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
 * !! NOTHING CALLS THIS YET. !!
 *
 * The hourly scheduledTrigger that drove it was removed deliberately, and no
 * replacement caller has been chosen. Until one exists the display condition on
 * `zenuml-byline-diagrams` can never be satisfied, so the Lite byline is hidden
 * on every installation — which is the fail-closed gate behaving correctly, not
 * a bug, but it does mean the feature is off until a caller lands.
 *
 * Whatever calls it must satisfy two constraints that are not negotiable:
 *
 * - It has to be a Forge function, because `asApp()` is the only accepted
 *   caller of this API (see the 401 above).
 * - It cannot be the byline itself. A hidden byline is never opened, so the
 *   surface that needs the property can never be the one that writes it.
 *
 * SCOPE, this change: the decision is unconditionally "visible". The
 * both-apps-installed suppression and the per-cloudId rollout gate are Phase 2
 * of docs/superpowers/plans/2026-08-15-byline-visibility-app-property.md, and
 * land here as a Remote call that replaces `decide()` below.
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

export type Decision = { value: string; decision: 'visible' | 'suppressed'; reason: string };

/**
 * Phase 1: everyone visible. Kept as a named seam so Phase 2 swaps one function
 * rather than restructuring the handler around it.
 */
function decide(): Decision {
  return { value: VISIBLE, decision: 'visible', reason: 'not_enrolled' };
}

async function readCurrent(): Promise<{ value?: string; version?: number; status: number }> {
  const res = await api.asApp().requestConfluence(PROP_ROUTE);
  if (!res.ok) return { status: res.status };
  // Text, then parse: a non-JSON body on an unexpected status would otherwise
  // throw here and lose the status code, which is the useful part.
  const body = await res.text().catch(() => '');
  try {
    const parsed = JSON.parse(body);
    return { value: String(parsed?.value), version: parsed?.version?.number, status: res.status };
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
async function write(value: string, currentVersion?: number): Promise<{ ok: boolean; status: number; via: string }> {
  const bare = await api.asApp().requestConfluence(PROP_ROUTE, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: PROPERTY_KEY, value }),
  });
  if (bare.ok) return { ok: true, status: bare.status, via: 'no_version' };

  const next = (currentVersion ?? 0) + 1;
  const versioned = await api.asApp().requestConfluence(PROP_ROUTE, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: PROPERTY_KEY, value, version: { number: next } }),
  });
  return { ok: versioned.ok, status: versioned.status, via: `version_${next}` };
}

export async function scheduledHandler() {
  const { value: target, decision, reason } = decide();
  console.log(`${L} evaluated decision=${decision} reason=${reason} target=${target}`);

  const current = await readCurrent();
  console.log(`${L} current status=${current.status} value=${String(current.value)} version=${String(current.version)}`);

  // Idempotence is not a micro-optimisation here: without it every tick writes,
  // which burns a request per install per hour and makes 'unchanged' — the
  // expected steady state — unobservable.
  if (current.value === target) {
    console.log(`${L} write result=unchanged`);
    return;
  }

  const res = await write(target, current.version);
  console.log(
    `${L} write result=${res.ok ? (target === VISIBLE ? 'written' : 'cleared') : 'failed'} ` +
      `status=${res.status} via=${res.via}`,
  );
}
