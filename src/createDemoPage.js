import api, { route, storage } from '@forge/api';
import Resolver from '@forge/resolver';
import { DEMO_PAGE_ADF, DEMO_PAGE_TITLE } from './demoPageContent';

const ADMIN_GROUP_RE = /^(site-admins|confluence-admins(-.+)?|confluence-administrators)$/;

async function resolveSpace(spaceKey) {
  try {
    const res = await api
      .asUser()
      .requestConfluence(route`/wiki/api/v2/spaces?keys=${spaceKey}`);
    if (!res.ok) return { ok: false, status: 500, error: 'space_lookup_failed' };
    const body = await res.json();
    const hit = body && body.results && body.results[0];
    if (!hit) return { ok: false, status: 404, error: 'space_not_found' };
    if (hit.type !== 'global' || hit.status !== 'current') {
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

export async function createDemoPageImpl({ payload, context }) {
  if (!(await isCallerSiteAdmin(context.accountId))) {
    return { ok: false, status: 403, error: 'not_authorized' };
  }

  const resolved = await resolveSpace(payload.spaceKey);
  if (!resolved.ok) {
    return { ok: false, status: resolved.status, error: resolved.error };
  }
  const { space } = resolved;

  const markerKey = `demo-page:${space.key}`;
  const existing = await storage.get(markerKey);
  if (existing) {
    return { ok: true, alreadyExists: true, pageId: existing.pageId, createdAt: existing.createdAt };
  }

  const res = await api.asApp().requestConfluence(route`/wiki/api/v2/pages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      spaceId: space.id,
      status: 'current',
      title: DEMO_PAGE_TITLE,
      body: {
        representation: 'atlas_doc_format',
        value: JSON.stringify(DEMO_PAGE_ADF),
      },
    }),
  });

  if (!res.ok) {
    let detail = '';
    try {
      detail = await res.text();
    } catch {
      /* ignore */
    }
    return { ok: false, status: res.status, error: 'create_failed', detail };
  }

  const created = await res.json();
  const createdAt = new Date().toISOString();
  await storage.set(markerKey, { pageId: created.id, createdAt, source: 'manual' });

  console.log(
    JSON.stringify({
      event: 'demo_page_created',
      cloudId: context.cloudId,
      spaceKey: space.key,
      pageId: created.id,
      source: 'manual',
      createdAt,
    }),
  );

  return { ok: true, pageId: created.id, createdAt };
}

const resolver = new Resolver();
resolver.define('createDemoPage', ({ payload, context }) =>
  createDemoPageImpl({ payload, context }),
);

export const handler = resolver.getDefinitions();
