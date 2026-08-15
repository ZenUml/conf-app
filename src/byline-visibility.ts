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
  const { value: target, decision, reason } = decide();
  console.log(`${L} evaluated decision=${decision} reason=${reason} target=${target}`);

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
