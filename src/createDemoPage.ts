import api, { route, storage } from '@forge/api';

type Payload = { spaceKey: string };
type Context = { accountId: string; cloudId: string };

const ADMIN_GROUP_RE = /^(site-admins|confluence-admins(-.+)?)$/;

type ResolvedSpace = { id: string; key: string };
type SpaceResolutionResult =
  | { ok: true; space: ResolvedSpace }
  | { ok: false; status: 404 | 400 | 500; error: string };

async function resolveSpace(spaceKey: string): Promise<SpaceResolutionResult> {
  try {
    const res = await api
      .asUser()
      .requestConfluence(route`/wiki/api/v2/spaces?keys=${spaceKey}`);
    if (!res.ok) return { ok: false, status: 500, error: 'space_lookup_failed' };
    const body = (await res.json()) as {
      results?: Array<{ id: string; key: string; type?: string; status?: string }>;
    };
    const hit = body.results?.[0];
    if (!hit) return { ok: false, status: 404, error: 'space_not_found' };
    if (hit.type !== 'global' || hit.status !== 'current') {
      return { ok: false, status: 400, error: 'space_not_eligible' };
    }
    return { ok: true, space: { id: hit.id, key: hit.key } };
  } catch {
    return { ok: false, status: 500, error: 'space_lookup_failed' };
  }
}

async function isCallerSiteAdmin(accountId: string): Promise<boolean> {
  try {
    const res = await api
      .asUser()
      .requestConfluence(
        route`/wiki/rest/api/user/memberof?accountId=${accountId}&start=0&limit=200`,
      );
    if (!res.ok) return false;
    const body = (await res.json()) as { results?: Array<{ name?: string }> };
    const groups = body?.results ?? [];
    return groups.some(g => typeof g?.name === 'string' && ADMIN_GROUP_RE.test(g.name));
  } catch {
    return false;
  }
}

export const handler = async ({
  payload,
  context,
}: {
  payload: Payload;
  context: Context;
}) => {
  if (!(await isCallerSiteAdmin(context.accountId))) {
    return { ok: false, status: 403, error: 'not_authorized' };
  }

  const resolved = await resolveSpace(payload.spaceKey);
  if (!resolved.ok) {
    return { ok: false, status: resolved.status, error: resolved.error };
  }
  const { space } = resolved;

  const markerKey = `demo-page:${space.key}`;
  const existing = (await storage.get(markerKey)) as
    | { pageId: string; createdAt: string; source: 'manual' }
    | undefined;
  if (existing) {
    return { ok: true, alreadyExists: true, pageId: existing.pageId, createdAt: existing.createdAt };
  }

  // Subsequent tasks add: POST, marker write, log.
  return { ok: false, status: 501, error: 'not_implemented', spaceId: space.id };
};
