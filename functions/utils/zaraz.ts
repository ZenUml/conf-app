
import { fetchOut, ZARAZ_TIMEOUT_MS } from './http';

const HTTP_API_ENDPOINT = 'https://zenuml.com/zaraz/api';

async function postData(eventType: string, appKey: string, clientKey: string, clientSite: string) {
  // JSON.stringify, not a template: a `"` in any value made the body invalid (#939).
  const body = JSON.stringify({
    events: [
      {
        client: {
          __zarazTrack: eventType,
          appKey,
          clientKey,
          clientSite,
          value: '200',
        },
      },
    ],
  });
  const response = await fetchOut(HTTP_API_ENDPOINT, {
    name: 'zaraz', timeoutMs: ZARAZ_TIMEOUT_MS,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  const data = await response.text();
  console.log(data);
}

export {
  postData
}
