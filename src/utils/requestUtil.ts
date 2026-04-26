export async function loadAllPaginatedData(requestFunc: any, initialUrl: string, consumer: (data: any) => void): Promise<any> {
  let data, url = initialUrl;
  do {
    data = await requestFunc(url);
    consumer(data);
    url = data?._links?.next || '';

    const prefix = '/wiki';
    if (url.startsWith(prefix)) {
      url = url.substring(prefix.length);
    }
  } while (url);
};

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

export async function forgeRequest(url: string, method: string = 'GET', data: any = undefined): Promise<any> {
  if (isStandaloneEnv()) {
    const mockAp = await getMockAp();
    const apiUrl = url.startsWith('/wiki') ? url.substring(5) : url;
    const response = await mockAp.request({ url: apiUrl, type: method, body: data ? JSON.stringify(data) : undefined });
    return response ? JSON.parse(response.body) : undefined;
  }
  const { requestConfluence } = await import("@forge/bridge");
  return (await requestConfluence(url, {
    method,
    headers: {
      'Content-Type': 'application/json'
    },
    body: data && JSON.stringify(data)
  })).json();
}

export async function forgeCallRemote(url: string, method: string = 'GET', data: any = undefined): Promise<any> {
  const { invokeRemote } = await import("@forge/bridge");
  console.debug('forgeCallRemote - url:', url, 'method:', method, 'data:', data);
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
    const body = typeof response.body === 'string' ? response.body : JSON.stringify(response.body);
    throw new Error(`HTTP ${response.status}: ${body || 'No body'}`);
  }

  return response.body;
}
