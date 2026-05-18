import api, { route, storage } from '@forge/api';

type Payload = { spaceKey: string };
type Context = { accountId: string; cloudId: string };

const ADMIN_GROUP_RE = /^(site-admins|confluence-admins(-.+)?)$/;

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

  // Subsequent tasks add: space resolve, idempotency, POST, marker write, log.
  return { ok: false, status: 501, error: 'not_implemented' };
};
