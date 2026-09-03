interface Env {
  SPACE_LICENSE_KV: KVNamespace;
  ADMIN_API_SECRET: string;
}

export interface SpaceLicenseRecord {
  cloudId: string;
  spaceKey: string;
  status: 'active' | 'inactive';
  activatedBy: string;
  paymentReference?: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  userAccountId?: string;
}

interface LicenseIndexEntry {
  cloudId: string;
  spaceKey: string;
  userAccountId?: string;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function validateAdminAuth(request: Request, env: Env): boolean {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) return false;
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return false;
  return parts[1] === env.ADMIN_API_SECRET;
}

/**
 * The one place a license KV key is spelled. Exported because other endpoints
 * now write grants of their own (the paywall pricing survey's automatic 15-day
 * reward), and a second hand-rolled template is how a grant ends up unreadable
 * by space-status.
 *
 * With a userAccountId the grant covers ONLY that user on that space; without
 * one it covers everybody on the space.
 */
export function spaceLicenseKey(cloudId: string, spaceKey: string, userAccountId?: string): string {
  return userAccountId
    ? `license:${cloudId}:${spaceKey}:${userAccountId}`
    : `license:${cloudId}:${spaceKey}`;
}

// Local alias — the handlers below read better with the short name.
const kvKey = spaceLicenseKey;

async function getIndex(kv: KVNamespace): Promise<LicenseIndexEntry[]> {
  const raw = await kv.get('license-index');
  if (!raw) return [];
  try {
    return JSON.parse(raw) as LicenseIndexEntry[];
  } catch {
    return [];
  }
}

async function updateIndex(
  kv: KVNamespace,
  cloudId: string,
  spaceKey: string,
  userAccountId?: string
): Promise<void> {
  const index = await getIndex(kv);
  const exists = index.some(
    (e) => e.cloudId === cloudId && e.spaceKey === spaceKey && e.userAccountId === userAccountId
  );
  if (!exists) {
    index.push({ cloudId, spaceKey, ...(userAccountId && { userAccountId }) });
    await kv.put('license-index', JSON.stringify(index));
  }
}

export interface UpsertSpaceLicenseInput {
  cloudId: string;
  spaceKey: string;
  userAccountId?: string;
  expiresAt: string;
  activatedBy: string;
  paymentReference?: string;
}

/**
 * Write (or refresh) one space license and keep the index in step.
 *
 * Upsert, not replace: an existing record keeps its createdAt and is set back
 * to 'active' with the new expiry and activator. `created` reports which of the
 * two happened, which is what POST /api/space-license turns into 201 vs 200.
 *
 * Callers own the policy — this helper never decides whether a grant is
 * deserved, only how it is stored. Validation of the inputs (a non-empty
 * userAccountId, a parseable expiresAt) belongs to the caller too.
 */
export async function upsertSpaceLicense(
  kv: KVNamespace,
  input: UpsertSpaceLicenseInput
): Promise<{ record: SpaceLicenseRecord; created: boolean }> {
  const { cloudId, spaceKey, userAccountId, expiresAt, activatedBy, paymentReference } = input;
  const key = spaceLicenseKey(cloudId, spaceKey, userAccountId);
  const now = new Date().toISOString();

  const existing = await kv.get(key);
  let record: SpaceLicenseRecord;

  if (existing) {
    const parsed = JSON.parse(existing) as SpaceLicenseRecord;
    record = {
      ...parsed,
      status: 'active',
      activatedBy,
      expiresAt,
      updatedAt: now,
      ...(paymentReference !== undefined && { paymentReference }),
    };
  } else {
    record = {
      cloudId,
      spaceKey,
      status: 'active',
      activatedBy,
      expiresAt,
      createdAt: now,
      updatedAt: now,
      ...(paymentReference !== undefined && { paymentReference }),
      ...(userAccountId !== undefined && { userAccountId }),
    };
  }

  await kv.put(key, JSON.stringify(record));
  await updateIndex(kv, cloudId, spaceKey, userAccountId);

  return { record, created: !existing };
}

async function handlePost(
  request: Request,
  kv: KVNamespace
): Promise<Response> {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { error: 'invalid_json', message: 'Invalid JSON body' });
  }

  const { cloudId, spaceKey, expiresAt, activatedBy, paymentReference, userAccountId } = body;

  if (!cloudId || !spaceKey || !expiresAt || !activatedBy) {
    return jsonResponse(400, {
      error: 'missing_fields',
      message: 'Required fields: cloudId, spaceKey, expiresAt, activatedBy',
    });
  }

  // Validate expiresAt is a valid date
  if (isNaN(Date.parse(expiresAt))) {
    return jsonResponse(400, {
      error: 'invalid_date',
      message: 'expiresAt must be a valid ISO 8601 date string',
    });
  }

  // A user-scoped grant with a blank accountId would unlock anyone whose
  // token is missing a principal — refuse rather than write a placeholder key.
  if (userAccountId !== undefined && (typeof userAccountId !== 'string' || !userAccountId.trim())) {
    return jsonResponse(400, {
      error: 'invalid_user_account_id',
      message: 'userAccountId must be a non-empty string when provided',
    });
  }

  const { record, created } = await upsertSpaceLicense(kv, {
    cloudId,
    spaceKey,
    userAccountId,
    expiresAt,
    activatedBy,
    paymentReference,
  });

  return jsonResponse(created ? 201 : 200, record);
}

async function handleGet(
  request: Request,
  kv: KVNamespace
): Promise<Response> {
  const url = new URL(request.url);
  const filterCloudId = url.searchParams.get('cloudId');
  const filterStatus = url.searchParams.get('status');

  const index = await getIndex(kv);

  // Fetch all records
  const records: SpaceLicenseRecord[] = [];
  for (const entry of index) {
    if (filterCloudId && entry.cloudId !== filterCloudId) continue;

    const raw = await kv.get(kvKey(entry.cloudId, entry.spaceKey, entry.userAccountId));
    if (!raw) continue;

    const record = JSON.parse(raw) as SpaceLicenseRecord;
    if (filterStatus && record.status !== filterStatus) continue;

    records.push(record);
  }

  return jsonResponse(200, { licenses: records, total: records.length });
}

async function handleDelete(
  request: Request,
  kv: KVNamespace
): Promise<Response> {
  const url = new URL(request.url);
  const cloudId = url.searchParams.get('cloudId');
  const spaceKey = url.searchParams.get('spaceKey');
  const userAccountId = url.searchParams.get('userAccountId') || undefined;

  if (!cloudId || !spaceKey) {
    return jsonResponse(400, {
      error: 'missing_params',
      message: 'Required query params: cloudId, spaceKey',
    });
  }

  const key = kvKey(cloudId, spaceKey, userAccountId);
  const raw = await kv.get(key);

  if (!raw) {
    return jsonResponse(404, {
      error: 'not_found',
      message: 'License not found',
    });
  }

  const record = JSON.parse(raw) as SpaceLicenseRecord;
  record.status = 'inactive';
  record.updatedAt = new Date().toISOString();

  await kv.put(key, JSON.stringify(record));

  return jsonResponse(200, record);
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  // Admin auth check — all methods require ADMIN_API_SECRET
  if (!env.ADMIN_API_SECRET) {
    console.error('ADMIN_API_SECRET environment variable is not set');
    return jsonResponse(500, {
      error: 'server_configuration',
      message: 'ADMIN_API_SECRET not configured',
    });
  }

  if (!validateAdminAuth(request, env)) {
    return jsonResponse(401, {
      error: 'unauthorized',
      message: 'Invalid or missing admin API secret',
    });
  }

  if (!env.SPACE_LICENSE_KV) {
    return jsonResponse(500, {
      error: 'server_configuration',
      message: 'SPACE_LICENSE_KV binding not configured',
    });
  }

  switch (request.method) {
    case 'POST':
      return handlePost(request, env.SPACE_LICENSE_KV);
    case 'GET':
      return handleGet(request, env.SPACE_LICENSE_KV);
    case 'DELETE':
      return handleDelete(request, env.SPACE_LICENSE_KV);
    default:
      return jsonResponse(405, {
        error: 'method_not_allowed',
        message: 'Method Not Allowed',
      });
  }
};
