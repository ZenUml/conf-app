import { ForgeRequestError } from "@/utils/forgeRequestError";
import { RemoteCallError } from './remoteCallError';

export async function loadAllPaginatedData(requestFunc: any, initialUrl: string, consumer: (data: any) => void): Promise<void> {
  return loadPaginatedDataUntil(requestFunc, initialUrl, consumer, () => false);
}

/**
 * Like loadAllPaginatedData, but stops following `_links.next` as soon as
 * `shouldStop()` returns true (checked after each page is consumed). Lets a
 * caller bound the work — e.g. stop counting once a threshold is crossed — so a
 * latency-critical path never enumerates an entire huge space.
 */
export async function loadPaginatedDataUntil(
  requestFunc: any,
  initialUrl: string,
  consumer: (data: any) => void,
  shouldStop: () => boolean,
): Promise<void> {
  let data, url = initialUrl;
  do {
    data = await requestFunc(url);
    consumer(data);
    if (shouldStop()) return;
    url = data?._links?.next || '';

    const prefix = '/wiki';
    if (url.startsWith(prefix)) {
      url = url.substring(prefix.length);
    }
  } while (url);
}

function isStandaloneEnv(): boolean {
  try {
    return typeof window !== 'undefined' && window.self === window.top;
  } catch {
    return false;
  }
}

let _mockAp: any = null;
async function getMockAp() {
  if (!_mockAp) {
    const { default: MockAp } = await import('@/model/MockAp');
    _mockAp = new MockAp();
  }
  return _mockAp;
}

export interface ForgeRequestOptions {
  /**
   * Throw `ForgeRequestError` (with `status`) when the response is not 2xx,
   * even if the body parses as JSON. Off by default: most callers read a 4xx
   * `{ errors: [...] }` envelope as data (404 orphan recovery, version
   * conflicts, paginated counts). Opt in only where a failed status must not
   * be mistaken for success. Not applied in the standalone (MockAp) branch,
   * which has no HTTP status.
   */
  throwOnHttpError?: boolean;
}

export async function forgeRequest(url: string, method: string = 'GET', data: any = undefined, options: ForgeRequestOptions = {}): Promise<any> {
  if (isStandaloneEnv()) {
    const mockAp = await getMockAp();
    const apiUrl = url.startsWith('/wiki') ? url.substring(5) : url;
    const response = await mockAp.request({ url: apiUrl, type: method, body: data ? JSON.stringify(data) : undefined });
    return response ? JSON.parse(response.body) : undefined;
  }
  const { requestConfluence } = await import("@forge/bridge");
  const response = await requestConfluence(url, {
    method,
    headers: {
      'Content-Type': 'application/json'
    },
    body: data && JSON.stringify(data)
  });
  // Callers rely on getting the parsed body whatever the HTTP status — a 4xx
  // `{ errors: [...] }` envelope is data to them (e.g. loadCustomContentV2's
  // not_found). So a JSON body is returned as-is. Only a body that does not
  // parse (an HTML error/login page, an empty body) throws, and it now throws
  // ForgeRequestError carrying the status instead of a bare SyntaxError.
  const text = await response.text();
  const contentType = response.headers.get('content-type') ?? '';
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ForgeRequestError({ status: response.status, method, url, contentType, body: text });
  }
  if (options.throwOnHttpError && !response.ok) {
    throw new ForgeRequestError({ status: response.status, method, url, contentType, body: text, nonJson: false });
  }
  return parsed;
}

export async function forgeCallRemote(url: string, method: string = 'GET', data: any = undefined): Promise<any> {
  const { invokeRemote } = await import("@forge/bridge");
  // Request bodies may contain customer-authored content or an explicitly
  // attached feedback image. Never copy payloads into browser diagnostics.
  console.debug('forgeCallRemote - url:', url, 'method:', method);
  return await invokeRemote({
    path: url,
    method: method as any,
    headers: {
      'Content-Type': 'application/json'
    },
    body: data
  });
}

export async function forgeCallFunction(functionName: string, data: any = undefined): Promise<any> {
  const { invoke } = await import("@forge/bridge");
  console.log('forgeCallFunction - functionName:', functionName, 'data:', data);
  return await invoke(functionName, data);
}

export async function callRemote(
  endpoint: string,
  method: string = 'GET',
  data: any = undefined
): Promise<any> {
  const forgeGlobal = await import('@/model/globals/forgeGlobal');

  const url = `${forgeGlobal.default.zenumlRemoteBaseUrl}${endpoint}`;

  const response = await forgeCallRemote(url, method, data);
  if (response.status !== 200 && response.status !== 201) {
    throw new RemoteCallError({ status: response.status, method, endpoint, body: response.body });
  }

  return response.body;
}
