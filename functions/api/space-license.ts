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
}

interface LicenseIndexEntry {
  cloudId: string;
  spaceKey: string;
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

function kvKey(cloudId: string, spaceKey: string): string {
  return `license:${cloudId}:${spaceKey}`;
}

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
  spaceKey: string
): Promise<void> {
  const index = await getIndex(kv);
  const exists = index.some(
    (e) => e.cloudId === cloudId && e.spaceKey === spaceKey
  );
  if (!exists) {
    index.push({ cloudId, spaceKey });
    await kv.put('license-index', JSON.stringify(index));
  }
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

  const { cloudId, spaceKey, expiresAt, activatedBy, paymentReference } = body;

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

  const key = kvKey(cloudId, spaceKey);
  const now = new Date().toISOString();

  // Check for existing record (upsert)
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
    };
  }

  await kv.put(key, JSON.stringify(record));
  await updateIndex(kv, cloudId, spaceKey);

  const statusCode = existing ? 200 : 201;
  return jsonResponse(statusCode, record);
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

    const raw = await kv.get(kvKey(entry.cloudId, entry.spaceKey));
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

  if (!cloudId || !spaceKey) {
    return jsonResponse(400, {
      error: 'missing_params',
      message: 'Required query params: cloudId, spaceKey',
    });
  }

  const key = kvKey(cloudId, spaceKey);
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
