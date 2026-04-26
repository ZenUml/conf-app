import { getAuthorizationHeader } from '../utils/requestUtils';
import { validateContextToken } from '../utils/authenticate';
import { captureError } from '../utils/sentry';

interface Env {
  MACRO_AUTHORSHIP_KV?: KVNamespace;
  ALLOWED_FORGE_APP_IDS?: string;
  CONFLUENCE_API_BASE?: string; // optional, for tests
}

interface NotifyResponse {
  notified: boolean;
  reason?: 'rate_limited' | 'no_admins';
  adminCount?: number;
  error?: string;
  message?: string;
}

const RATE_LIMIT_TTL_SECONDS = 7 * 24 * 60 * 60;

function jsonResponse(status: number, body: NotifyResponse): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

async function resolveSpaceAdmins(
  apiBase: string,
  spaceKey: string,
  jwt: string
): Promise<string[]> {
  const url = `${apiBase}/rest/api/space/${encodeURIComponent(spaceKey)}/permission?expand=subjects.user&limit=200`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  if (!res.ok) {
    throw new Error(`Admin lookup failed: ${res.status}`);
  }
  const data: any = await res.json();
  const results: any[] = Array.isArray(data?.results) ? data.results : [];
  const adminIds: string[] = [];
  for (const r of results) {
    if (r?.operation?.operation === 'administer') {
      const accountId = r?.subjects?.user?.accountId;
      if (accountId) adminIds.push(accountId);
    }
  }
  return adminIds;
}

async function sendNotification(
  apiBase: string,
  jwt: string,
  accountId: string,
  title: string,
  body: string
): Promise<void> {
  const res = await fetch(`${apiBase}/rest/api/notifications`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      recipient: { accountId },
      title,
      body,
    }),
  });
  if (!res.ok) {
    throw new Error(`Notification send failed: ${res.status}`);
  }
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  if (request.method !== 'POST') {
    return jsonResponse(405, {
      notified: false,
      error: 'method_not_allowed',
      message: 'Method Not Allowed',
    });
  }

  try {
    const jwt = getAuthorizationHeader(request);
    if (!jwt) {
      return jsonResponse(401, {
        notified: false,
        error: 'unauthorized',
        message: 'Missing or invalid Authorization header',
      });
    }

    const allowedForgeAppIds = env.ALLOWED_FORGE_APP_IDS;
    if (!allowedForgeAppIds) {
      return jsonResponse(401, {
        notified: false,
        error: 'unauthorized',
        message: 'ALLOWED_FORGE_APP_IDS not configured',
      });
    }

    let payload: any;
    try {
      payload = await validateContextToken(jwt, allowedForgeAppIds);
    } catch (err) {
      return jsonResponse(401, {
        notified: false,
        error: 'unauthorized',
        message: 'Token validation failed',
      });
    }

    const cloudId = payload?.payload?.context?.cloudId;
    const requesterAccountId = payload?.payload?.context?.accountId;
    if (!cloudId || !requesterAccountId) {
      return jsonResponse(401, {
        notified: false,
        error: 'unauthorized',
        message: 'Missing cloudId or accountId in context',
      });
    }

    let body: any;
    try {
      body = await request.json();
    } catch {
      return jsonResponse(400, {
        notified: false,
        error: 'bad_request',
        message: 'Invalid JSON body',
      });
    }

    const spaceKey: string | undefined = body?.spaceKey;
    if (!spaceKey || typeof spaceKey !== 'string') {
      return jsonResponse(400, {
        notified: false,
        error: 'bad_request',
        message: 'Missing required field: spaceKey',
      });
    }
    const requesterDisplayName: string | undefined =
      typeof body?.requesterDisplayName === 'string' ? body.requesterDisplayName : undefined;

    const kv = env.MACRO_AUTHORSHIP_KV;
    const rlKey = `notify_rl:${cloudId}:${spaceKey}:${requesterAccountId}`;

    if (kv) {
      const existing = await kv.get(rlKey);
      if (existing !== null) {
        return jsonResponse(200, { notified: false, reason: 'rate_limited' });
      }
      // Write rate-limit key FIRST to prevent abuse and endless retry loops.
      try {
        await kv.put(rlKey, String(Date.now()), { expirationTtl: RATE_LIMIT_TTL_SECONDS });
      } catch (err) {
        console.warn('notify-admin: rate-limit key write failed', err);
      }
    }

    const apiBase =
      env.CONFLUENCE_API_BASE ?? `https://api.atlassian.com/ex/confluence/${cloudId}/wiki`;

    let admins: string[] = [];
    try {
      admins = await resolveSpaceAdmins(apiBase, spaceKey, jwt);
    } catch (err) {
      console.warn('notify-admin: admin lookup failed', err);
      return jsonResponse(200, { notified: false, reason: 'no_admins', adminCount: 0 });
    }

    if (admins.length === 0) {
      return jsonResponse(200, { notified: false, reason: 'no_admins', adminCount: 0 });
    }

    const title = 'ZenUML — space upgrade requested';
    const message = `${requesterDisplayName ?? 'A teammate'} hit the ZenUML Lite limit on space ${spaceKey} and is asking you to upgrade.`;

    for (const adminAccountId of admins) {
      try {
        await sendNotification(apiBase, jwt, adminAccountId, title, message);
      } catch (err) {
        console.warn('notify-admin: notification send failed', err);
        captureError(err);
      }
    }

    return jsonResponse(200, { notified: true, adminCount: admins.length });
  } catch (error) {
    console.error('notify-admin: unexpected error', error);
    captureError(error);
    return jsonResponse(500, {
      notified: false,
      error: 'internal_error',
      message: 'Internal Server Error',
    });
  }
};
