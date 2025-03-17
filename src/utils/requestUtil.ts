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