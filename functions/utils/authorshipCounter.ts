const ENCODER = new TextEncoder();

export async function hashAccountId(accountId: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', ENCODER.encode(accountId));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function key(cloudId: string, spaceKey: string, hashedUser: string): string {
  return `authored:${cloudId}:${spaceKey}:${hashedUser}`;
}

export async function incrementAuthorship(
  kv: KVNamespace,
  cloudId: string,
  spaceKey: string,
  accountId: string
): Promise<number> {
  const hashed = await hashAccountId(accountId);
  const k = key(cloudId, spaceKey, hashed);
  const current = await kv.get(k);
  const next = (current ? parseInt(current, 10) : 0) + 1;
  await kv.put(k, String(next));
  return next;
}

export async function getPersonalAuthored(
  kv: KVNamespace,
  cloudId: string,
  spaceKey: string,
  accountId: string
): Promise<number> {
  const hashed = await hashAccountId(accountId);
  const v = await kv.get(key(cloudId, spaceKey, hashed));
  return v ? parseInt(v, 10) : 0;
}
