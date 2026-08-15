import api, { route } from '@forge/api';

/**
 * THROWAWAY SPIKE — do not merge.
 *
 * Answers the three open questions blocking Phase 4 of
 * docs/superpowers/plans/2026-08-15-byline-visibility-app-property.md, none of
 * which can be probed with curl: the Confluence app-properties API rejects
 * every non-Forge caller outright (`401
 * app.property.rest.add_or_delete_on_properties.not_forge_request`), so the
 * only way to exercise it is from inside a deployed Forge function.
 *
 *   1. Can a Forge function write an `entity: app` property at all, and what
 *      does a GET of a never-written key return?
 *   2. Does PUT require `version.number` on UPDATE? Confluence property APIs
 *      generally do and answer 409 without it, but the app-properties docs
 *      mention only "an object containing the property value". A
 *      create-succeeds / update-409s app would look healthy on a fresh tenant
 *      and fail on every subsequent flip, so the second write is the one that
 *      matters.
 *   3. Does `displayConditions.entityPropertyEqualTo` with `entity: app`
 *      actually gate a contentBylineItem, and does a MISSING property hide it?
 *      (3) is answered by looking at the page, not by this file — but this file
 *      is what puts the property into each state.
 *
 * Runs on a fiveMinute schedule purely for spike turnaround. Everything here is
 * console.log-driven; `forge logs -e yanhui` is the readout.
 */

const PROPERTY_KEY = 'byline-enabled';

/**
 * Built once, as a literal template. NOT `route\`${somePath}\`` — `route` is a
 * tagged template that percent-encodes its interpolations, so feeding it a
 * whole path would escape the slashes and produce a single nonsense segment.
 * Only genuinely dynamic segments belong in the `${}`.
 */
const PROP_ROUTE = route`/wiki/api/v2/app/properties/byline-enabled`;

/**
 * The value written on each run. Flip this and redeploy to drive the property
 * through create -> update, which is what exercises question 2 and lets the
 * byline be observed in both states for question 3.
 *
 * A STRING, not a boolean, and that is a finding rather than a style choice:
 * `forge lint` rejects a boolean in the matching display condition outright —
 *   Display conditions ... are invalid. "value" property must be string.
 * The condition compares against `"true"`, so the stored value has to be the
 * string too or the comparison can never match. (The same lint run also proved
 * `entityPropertyEqualTo` IS accepted on a contentBylineItem — the accompanying
 * "property is not allowed" error was a cascade of the type error and vanished
 * once the value became a string.)
 */
const SPIKE_VALUE = 'true';

const L = '[byline-spike]';

type Probe = { status: number; ok: boolean; body: string };

async function call(init?: Parameters<ReturnType<typeof api.asApp>['requestConfluence']>[1]): Promise<Probe> {
  const res = await api.asApp().requestConfluence(PROP_ROUTE, init);
  // Body is read as text, never JSON.parse: a 4xx here can come back as HTML or
  // empty, and a parse failure would mask the status code that IS the answer.
  const body = await res.text().catch(() => '<unreadable>');
  return { status: res.status, ok: res.ok, body: body.slice(0, 600) };
}

export async function scheduledHandler() {
  // Q1 — what does a read of a possibly-absent key look like?
  const before = await call();
  console.log(`${L} GET before -> ${before.status} ${before.body}`);

  // A version number is only knowable from a successful read. Absent (first
  // run) it stays undefined, which is exactly the create case.
  let currentVersion: number | undefined;
  try {
    currentVersion = JSON.parse(before.body)?.version?.number;
  } catch {
    currentVersion = undefined;
  }
  console.log(`${L} parsed current version -> ${String(currentVersion)}`);

  // Q2a — PUT with NO version. If this succeeds on an update, the API does not
  // require versioning and the writer stays simple.
  const noVersion = await call({
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: PROPERTY_KEY, value: SPIKE_VALUE }),
  });
  console.log(`${L} PUT without version -> ${noVersion.status} ${noVersion.body}`);

  // Q2b — only if the bare PUT was rejected. Retrying unconditionally would
  // bump the version on a call that already succeeded and muddy the readout.
  if (!noVersion.ok) {
    const next = (currentVersion ?? 0) + 1;
    const withVersion = await call({
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: PROPERTY_KEY, value: SPIKE_VALUE, version: { number: next } }),
    });
    console.log(`${L} PUT with version ${next} -> ${withVersion.status} ${withVersion.body}`);
  }

  const after = await call();
  console.log(`${L} GET after -> ${after.status} ${after.body}`);
  console.log(`${L} intended value was ${String(SPIKE_VALUE)}`);
}
