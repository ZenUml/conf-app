export async function loadAllPaginatedData(requestFunc: any, initialUrl: string, consumer: (data: any) => void): Promise<any> {
  let data, url = initialUrl;
  do {
    data = await requestFunc(url);
    consumer(data);
    url = data?._links?.next || '';

    const prefix = '/wiki';
    if (url.startsWith(prefix)) {
      url = url.substring(prefix.length); //V2 API has the '/wiki' prefix that needs to be removed to use the 'request' JavaScript API
    }
  } while (url);
};

export async function forgeRequest(url: string, method: string = 'GET', data: any = undefined): Promise<any> {
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
  console.log('forgeCallRemote - url:', url, 'method:', method, 'data:', data);
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

export async function connectRequest(requestFn: any, url: string, type: string = 'GET', data: any = undefined): Promise<any> {
  const response = await requestFn(data ? {
    type,
    url,
    data: JSON.stringify(data),
    contentType: 'application/json'
  } : {type, url});
  return Object.assign({}, response && response.body && JSON.parse(response.body), {xhr: response.xhr});
}