/**
 * Identify the Forge GraphQL relay request made by one app's page-banner.
 *
 * A shared Confluence tenant can mount page banners from several Forge apps,
 * so URL matching alone cannot attribute a relay call to the app under test.
 */
export function isTargetFirstSeenRelay(payload: unknown, forgeAppId: string): boolean {
  if (!isRecord(payload)) return false;
  const input = recordAt(payload, 'variables', 'input');
  const call = recordAt(input, 'payload', 'call');
  const extensionId = input?.extensionId;
  const moduleKey = recordAt(input, 'payload', 'context')?.moduleKey;
  const path = call?.path;

  return (
    typeof extensionId === 'string'
    && extensionId.includes(`extension/${forgeAppId}/`)
    && moduleKey === 'zenuml-page-banner'
    && typeof path === 'string'
    && path.endsWith('/forge-user-behavior')
  );
}

/** The relay transport is successful only when its inner remote response is 2xx. */
export function isSuccessfulForgeRelay(payload: unknown): boolean {
  const invokeExtension = recordAt(payload, 'data', 'invokeExtension');
  const remotePayload = recordAt(invokeExtension, 'response', 'body', 'payload');
  const status = remotePayload?.status;
  return invokeExtension?.success === true && typeof status === 'number' && status >= 200 && status < 300;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function recordAt(value: unknown, ...path: string[]): Record<string, unknown> | undefined {
  let current: unknown = value;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return isRecord(current) ? current : undefined;
}
