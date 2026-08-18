import api, { route, storage, getAppContext } from '@forge/api';
import Resolver from '@forge/resolver';
import {
  buildDemoPageAdf,
  DEMO_PAGE_TITLE,
  MACROS,
} from './demoPageContent';

// Marker schema:
//   { state: 'creating', startedAt, source }
//   { state: 'done',     pageId, createdAt, source }
// Marker presence is terminal regardless of page status (criterion 6:
// archived/deleted = opt-out; pipeline must not regenerate).
const MARKER_KEY = (spaceKey) => `demo-page:${spaceKey}`;
const ENROLLMENT_KEY = (spaceKey) => `enrollment:${spaceKey}`;

// A 'creating' marker older than this is assumed to have crashed; the next
// caller may overwrite it. Without true CAS this is the best fence we have.
const CREATING_STALE_MS = 5 * 60 * 1000;

const ADMIN_GROUP_RE = /^(site-admins|confluence-admins(-.+)?|confluence-administrators)$/;

const PAGE_PROPERTY_KEY = 'diagramly-demo-page';

// Eligible space types for a shared examples page. 'global' is the legacy
// default; 'onboarding' is Atlassian's own demo space. 'collaboration' and
// 'knowledge_base' are the two types the redesigned Confluence UI actually
// assigns to newly-created team spaces (verified live on lite-dev: every
// space created through the current "Create space" flow comes back as
// type 'collaboration' — see DP space, created 2026-05-19). The original
// list only allowed 'global'/'onboarding', so every real-world space an
// admin picked failed with space_not_eligible; the unit tests never
// exercised 'collaboration' because they only ever fabricated 'global' or
// 'onboarding' fixtures. 'personal' stays excluded — a shared examples page
// has no business landing in someone's personal space.
const ELIGIBLE_SPACE_TYPES = ['global', 'onboarding', 'collaboration', 'knowledge_base'];

async function resolveSpace(spaceKey) {
  try {
    const res = await api
      .asApp()
      .requestConfluence(route`/wiki/api/v2/spaces?keys=${spaceKey}`);
    if (!res.ok) return { ok: false, status: 500, error: 'space_lookup_failed' };
    const body = await res.json();
    const hit = body && body.results && body.results[0];
    if (!hit) return { ok: false, status: 404, error: 'space_not_found' };
    if (!ELIGIBLE_SPACE_TYPES.includes(hit.type) || hit.status !== 'current') {
      return { ok: false, status: 400, error: 'space_not_eligible' };
    }
    return { ok: true, space: { id: hit.id, key: hit.key } };
  } catch {
    return { ok: false, status: 500, error: 'space_lookup_failed' };
  }
}

async function isCallerSiteAdmin(accountId) {
  try {
    const res = await api
      .asUser()
      .requestConfluence(
        route`/wiki/rest/api/user/memberof?accountId=${accountId}&start=0&limit=200`,
      );
    if (!res.ok) return false;
    const body = await res.json();
    const groups = (body && body.results) || [];
    return groups.some(g => g && typeof g.name === 'string' && ADMIN_GROUP_RE.test(g.name));
  } catch {
    return false;
  }
}

async function readErrorDetail(res) {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

async function createDraftPage(spaceId) {
  const res = await api.asApp().requestConfluence(route`/wiki/api/v2/pages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      spaceId,
      status: 'draft',
      title: DEMO_PAGE_TITLE,
      body: { representation: 'storage', value: '' },
    }),
  });
  if (!res.ok) {
    return { ok: false, status: res.status, error: 'draft_create_failed', detail: await readErrorDetail(res) };
  }
  const body = await res.json();
  return { ok: true, pageId: body.id };
}

async function createCustomContentForMacro(macro, draftPageId) {
  const res = await api.asApp().requestConfluence(route`/wiki/api/v2/custom-content`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      // Per-macro type — graph uses GRAPH_CUSTOM_CONTENT_TYPE, everything
      // else uses CUSTOM_CONTENT_TYPE (see demoPageContent.js MACROS).
      type: macro.contentType,
      pageId: draftPageId,
      title: macro.contentTitle,
      body: { value: JSON.stringify(macro.body), representation: 'raw' },
    }),
  });
  if (!res.ok) {
    return { ok: false, status: res.status, detail: await readErrorDetail(res), macroId: macro.id };
  }
  const body = await res.json();
  return { ok: true, macroId: macro.id, contentId: String(body.id) };
}

async function publishDraft(pageId, spaceId, adf) {
  // First publish of a draft uses version 1 — the draft's own "version 1" is
  // not counted as published. Bumping to 2 produces a 400 from /wiki/api/v2:
  // "Version number must be 1 when publishing a page for the first time".
  // Verified live against diagramly.atlassian.net.
  const res = await api.asApp().requestConfluence(route`/wiki/api/v2/pages/${pageId}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      id: pageId,
      spaceId,
      status: 'current',
      title: DEMO_PAGE_TITLE,
      body: { representation: 'atlas_doc_format', value: JSON.stringify(adf) },
      version: { number: 1, message: 'Demo page published' },
    }),
  });
  if (!res.ok) {
    return { ok: false, status: res.status, error: 'publish_failed', detail: await readErrorDetail(res) };
  }
  const body = await res.json();
  return { ok: true, pageId: body.id };
}

// Tags the page so frontend analytics (and any downstream analysis) can
// definitively identify a demo page. Failure is non-fatal — the page itself
// is published and the KV marker is sufficient to recover the page id.
async function tagDemoPage(pageId) {
  try {
    await api.asApp().requestConfluence(route`/wiki/api/v2/pages/${pageId}/properties`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        key: PAGE_PROPERTY_KEY,
        value: { isDemoPage: true, taggedAt: new Date().toISOString() },
      }),
    });
  } catch (e) {
    console.log(JSON.stringify({ event: 'demo_page_tag_failed', pageId, error: String(e && e.message || e) }));
  }
}

// Core flow: given a resolved space, produce a demo page IF no marker exists.
// Used by both the admin resolver and the scheduled pipeline. Returns a
// structured outcome; never throws unexpectedly.
//
// Marker outcomes:
//   - no marker            → write creating, build page, write done
//   - marker.state==='done'    → return alreadyExists (terminal — opt-out
//                                applies even if the page was later deleted)
//   - marker.state==='creating' and recent  → return in_progress
//   - marker.state==='creating' and stale   → treat as crashed; proceed
async function processDemoPageForSpace({ space, source, logContext }) {
  const markerKey = MARKER_KEY(space.key);
  const existing = await storage.get(markerKey);

  if (existing) {
    if (existing.state === 'done') {
      return { ok: true, alreadyExists: true, pageId: existing.pageId, createdAt: existing.createdAt };
    }
    if (existing.state === 'creating') {
      const ageMs = Date.now() - Date.parse(existing.startedAt || 0);
      if (Number.isFinite(ageMs) && ageMs < CREATING_STALE_MS) {
        return { ok: false, status: 409, error: 'in_progress', startedAt: existing.startedAt };
      }
      // fall through — stale 'creating' marker; we'll overwrite below
    }
    // Unknown legacy shape (e.g. pre-sentinel marker that stored {pageId, ...}
    // at the top level): treat as 'done' to honor existing demo pages.
    if (existing.state === undefined && existing.pageId) {
      return { ok: true, alreadyExists: true, pageId: existing.pageId, createdAt: existing.createdAt };
    }
  }

  // Write the creating sentinel BEFORE doing any work. This narrows the
  // two-callers race window to whatever Forge KV does between two writes;
  // without true CAS we cannot eliminate it.
  const startedAt = new Date().toISOString();
  await storage.set(markerKey, { state: 'creating', startedAt, source });

  // 1. Draft page so we have a container id for custom content.
  const draft = await createDraftPage(space.id);
  if (!draft.ok) {
    return { ok: false, status: draft.status, error: draft.error, detail: draft.detail };
  }

  // 2. Create one custom-content object per macro. On failure the draft +
  //    any successful custom-content objects are left orphaned (we
  //    intentionally do not hold a delete-page scope). Drafts aren't
  //    user-visible. The 'creating' marker times out and a retry can proceed.
  let customContentResults;
  try {
    customContentResults = await Promise.all(
      MACROS.map(m => createCustomContentForMacro(m, draft.pageId)),
    );
  } catch (e) {
    console.log(JSON.stringify({
      event: 'demo_page_custom_content_failed',
      reason: 'exception',
      detail: String(e && e.message || e),
      orphanDraftPageId: draft.pageId,
    }));
    return {
      ok: false,
      status: 500,
      error: 'custom_content_failed',
      detail: String(e && e.message || e),
      orphanDraftPageId: draft.pageId,
    };
  }
  const failed = customContentResults.find(r => !r.ok);
  if (failed) {
    console.log(JSON.stringify({
      event: 'demo_page_custom_content_failed',
      reason: 'http_error',
      macroId: failed.macroId,
      status: failed.status,
      detail: failed.detail,
      orphanDraftPageId: draft.pageId,
    }));
    return {
      ok: false,
      status: failed.status,
      error: 'custom_content_failed',
      detail: `macro=${failed.macroId} status=${failed.status} ${failed.detail || ''}`.trim(),
      orphanDraftPageId: draft.pageId,
    };
  }

  const idToContentId = {};
  for (const r of customContentResults) {
    idToContentId[r.macroId] = r.contentId;
  }

  // 3. Build the ADF body referencing the custom-content IDs. Forge ARI
  //    extensionKey form scopes the macro to the calling variant's own app
  //    so Confluence routing is unambiguous on multi-install sites.
  let adf;
  try {
    const appCtx = getAppContext();
    adf = buildDemoPageAdf(idToContentId, {
      appId: appCtx.appAri && appCtx.appAri.appId,
      environmentId: appCtx.environmentAri && appCtx.environmentAri.environmentId,
      environmentType: appCtx.environmentType,
    });
  } catch (e) {
    return {
      ok: false,
      status: 500,
      error: 'adf_build_failed',
      detail: String(e && e.message || e),
      orphanDraftPageId: draft.pageId,
    };
  }

  // 4. Publish the draft.
  const published = await publishDraft(draft.pageId, space.id, adf);
  if (!published.ok) {
    return {
      ok: false,
      status: published.status,
      error: published.error,
      detail: published.detail,
      orphanDraftPageId: draft.pageId,
    };
  }

  // 5. Tag the page so analytics can identify it. Best effort.
  await tagDemoPage(published.pageId);

  // 6. Promote the marker to 'done'. Once written, it's terminal: deleting
  //    the page later does NOT cause regeneration.
  const createdAt = new Date().toISOString();
  await storage.set(markerKey, { state: 'done', pageId: published.pageId, createdAt, source });

  console.log(
    JSON.stringify({
      event: 'demo_page_created',
      cloudId: logContext && logContext.cloudId,
      spaceKey: space.key,
      pageId: published.pageId,
      source,
      createdAt,
    }),
  );

  return { ok: true, pageId: published.pageId, createdAt };
}

// Admin path: writes the enrollment marker and (eagerly) processes the
// space. The scheduled trigger picks up any enrollments that don't yet
// have a demo page — e.g. if the admin process fails partway, or if the
// enrollment is set by something other than this UI in a follow-up slice.
export async function enrollSpaceImpl({ payload, context }) {
  if (!(await isCallerSiteAdmin(context.accountId))) {
    return { ok: false, status: 403, error: 'not_authorized' };
  }

  const resolved = await resolveSpace(payload.spaceKey);
  if (!resolved.ok) {
    return { ok: false, status: resolved.status, error: resolved.error };
  }
  const { space } = resolved;

  // Mark the space enrolled. Idempotent.
  const enrollmentKey = ENROLLMENT_KEY(space.key);
  const existingEnrollment = await storage.get(enrollmentKey);
  if (!existingEnrollment || existingEnrollment.state !== 'enabled') {
    await storage.set(enrollmentKey, {
      state: 'enabled',
      enabledAt: new Date().toISOString(),
      enabledBy: context.accountId,
    });
  }

  // Eagerly process so the admin sees an immediate result. The scheduled
  // trigger remains the safety net for any space that this synchronous run
  // misses.
  const result = await processDemoPageForSpace({
    space,
    source: 'admin',
    logContext: { cloudId: context.cloudId },
  });

  return { ...result, enrolled: true, spaceKey: space.key };
}

// Scheduled trigger handler: walks every enrollment marker and processes
// any enabled space whose demo-page marker is still absent. Crashes/retries
// are bounded by the CREATING_STALE_MS window.
export async function runEnrollmentPipelineImpl() {
  const enrollments = await listEnrollments();
  const summary = { scanned: enrollments.length, processed: 0, skipped: 0, errors: 0 };

  for (const enrollment of enrollments) {
    if (enrollment.value.state !== 'enabled') {
      summary.skipped += 1;
      continue;
    }
    const spaceKey = enrollment.key.replace(/^enrollment:/, '');
    const marker = await storage.get(MARKER_KEY(spaceKey));
    if (marker && (marker.state === 'done' || (marker.state === undefined && marker.pageId))) {
      summary.skipped += 1;
      continue;
    }

    const resolved = await resolveSpace(spaceKey);
    if (!resolved.ok) {
      summary.errors += 1;
      console.log(JSON.stringify({ event: 'enrollment_resolve_failed', spaceKey, error: resolved.error }));
      continue;
    }
    const result = await processDemoPageForSpace({
      space: resolved.space,
      source: 'pipeline',
      logContext: {},
    });
    if (result.ok && !result.alreadyExists) {
      summary.processed += 1;
    } else if (result.ok) {
      summary.skipped += 1;
    } else if (result.error === 'in_progress') {
      summary.skipped += 1;
    } else {
      summary.errors += 1;
    }
  }

  console.log(JSON.stringify({ event: 'enrollment_pipeline_tick', ...summary }));
  return summary;
}

// Iterates the enrollment KV via storage.query. Wrapped in a try/catch so a
// runtime without storage.query (older Forge CLI in dev) or an unexpected
// shape degrades to "no enrollments to process" instead of crashing the
// scheduled tick.
async function listEnrollments() {
  if (typeof storage.query !== 'function') return [];
  try {
    const out = [];
    let cursor;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const builder = storage.query();
      if (!builder || typeof builder.where !== 'function') return out;
      const q = builder.where('key', { condition: 'STARTS_WITH', value: 'enrollment:' });
      const page = await (cursor ? q.cursor(cursor).getMany() : q.getMany());
      if (page && page.results) {
        for (const r of page.results) out.push({ key: r.key, value: r.value });
      }
      cursor = page && page.nextCursor;
      if (!cursor) break;
    }
    return out;
  } catch (e) {
    console.log(JSON.stringify({ event: 'enrollment_list_failed', error: String(e && e.message || e) }));
    return [];
  }
}

const resolver = new Resolver();
resolver.define('createDemoPage', ({ payload, context }) =>
  // Back-compat resolver name — admin button still invokes 'createDemoPage'.
  // Internally we now write the enrollment marker too.
  enrollSpaceImpl({ payload, context }),
);
resolver.define('enrollSpace', ({ payload, context }) =>
  enrollSpaceImpl({ payload, context }),
);

export const handler = resolver.getDefinitions();
export const scheduledHandler = runEnrollmentPipelineImpl;
