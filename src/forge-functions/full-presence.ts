import {
  emptyTally,
  ensureSpaceProperty,
  formatTally,
  listSpaceIds,
} from './space-properties';

/**
 * The FULL app marking its presence, per space.
 *
 * Ships only in the Full variant (`fullPresenceFn` + `full-presence-daily`
 * are stripped from lite/diagramly/asyncapi manifests). Its single job is to
 * keep a `zenuml-full-active` space property on every space of every site
 * where Full is installed, so that the LITE app's byline display condition —
 * `not: entityPropertyExists` on this key — hides the Lite byline wherever
 * Full already provides its own surfaces. Space properties are site-global
 * across apps, which is what makes a marker written by one app readable by
 * another app's display condition.
 *
 * Why self-reporting instead of the plan doc's D1 ForgeInstallation lookup:
 * the doc itself records the D1 data as defective — cloudId NULL on most Lite
 * rows, and no uninstall event has ever produced a row — so presence inferred
 * from it needs a TTL and still cannot be trusted. An app writing "I am here"
 * from inside the installation is evidence, not inference.
 *
 * Daily, not hourly: presence changes at install/uninstall cadence, the sweep
 * costs a read per space per tick, and Full has real production installs. The
 * cost of the slower interval is that a NEW Full install shows the Lite byline
 * beside Full for up to a day (annoying, not dangerous).
 *
 * KNOWN GAP, deliberate: nothing removes the marker on Full UNINSTALL — Forge
 * has no reliable uninstall event (the plan doc's defect #2), so a site that
 * drops Full keeps its Lite byline hidden until the marker is cleaned by hand.
 * There is no analytics event for this write: the `full_presence_write` catalog
 * entry was deleted 2026-09-02 as unwired instrumentation (zero
 * trackAnalyticsEvent callers), so the gap is visible only in the Forge logs.
 */

export const FULL_PRESENCE_KEY = 'zenuml-full-active';
const FULL_PRESENCE_VALUE = { active: 'true' };

const L = '[full-presence]';

export async function scheduledHandler() {
  const tally = emptyTally();
  let spaceIds: string[];
  try {
    spaceIds = await listSpaceIds();
  } catch (e) {
    console.log(`${L} sweep aborted: ${e instanceof Error ? e.message : String(e)}`);
    console.log(`${L} write result=failed ${formatTally({ ...tally, failed: 1 })}`);
    return;
  }
  tally.spaces = spaceIds.length;
  for (const spaceId of spaceIds) {
    const outcome = await ensureSpaceProperty(spaceId, FULL_PRESENCE_KEY, FULL_PRESENCE_VALUE).catch(
      () => 'failed' as const,
    );
    tally[outcome] += 1;
  }
  console.log(
    `${L} write result=${tally.failed > 0 ? 'failed' : tally.created + tally.updated > 0 ? 'written' : 'unchanged'} ${formatTally(tally)}`,
  );
}
