
const HTTP_API_ENDPOINT = 'https://zenuml.com/zaraz/api';
const TIMEOUT_MS = 5000;

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
  const response = await fetch(HTTP_API_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const data = await response.text();
  console.log(data);
}

export {
  postData
}
