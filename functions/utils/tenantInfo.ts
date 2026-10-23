import { fetchOut, TENANT_INFO_TIMEOUT_MS } from './http';

/**
 * Result of the public `https://<site>.atlassian.net/_edge/tenant_info` lookup.
 * Callers keep their own failure semantics; this only unifies the request.
 *  - `unavailable`: network error or timeout
 *  - `not_found`: non-2xx response
 *  - `invalid`: 2xx with an unparseable body
 *  - `ok`: parsed body (`cloudId` is untrusted; callers validate it)
 */
export type TenantInfoResult =
  | { status: 'ok'; cloudId: unknown }
  | { status: 'unavailable' }
  | { status: 'not_found' }
  | { status: 'invalid' };

/** @param host full Atlassian site host, e.g. `example.atlassian.net` */
export async function tenantInfo(host: string): Promise<TenantInfoResult> {
  let response: Response;
  try {
    response = await fetchOut(`https://${host}/_edge/tenant_info`, {
      name: 'atlassian.tenant-info',
      timeoutMs: TENANT_INFO_TIMEOUT_MS,
      headers: { Accept: 'application/json', 'User-Agent': 'ZenUML-Support-Automation/1.0' },
    });
  } catch {
    return { status: 'unavailable' };
  }
  if (!response.ok) return { status: 'not_found' };
  try {
    const body = (await response.json()) as { cloudId?: unknown };
    return { status: 'ok', cloudId: body?.cloudId };
  } catch {
    return { status: 'invalid' };
  }
}
