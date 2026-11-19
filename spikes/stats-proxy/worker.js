// Forwards Statsig client SDK traffic so the Forge app only talks to *.zenuml.com.
// /v1/initialize -> featureassets.org, /v1/rgstr -> prodregistryv2.org,
// /v1/sdk_exception -> statsigapi.net. Anything else: 404.
// path -> full upstream URL (query string is appended).
const UPSTREAM = {
  '/v1/initialize': 'https://featureassets.org/v1/initialize',
  '/v1/rgstr': 'https://prodregistryv2.org/v1/rgstr',
  '/v1/sdk_exception': 'https://statsigapi.net/v1/sdk_exception',
  // SPIKE: Microsoft Clarity upload (clarity-js uses XHR withCredentials).
  '/clarity/collect': 'https://s.clarity.ms/collect',
};
const ALLOWED_ORIGIN = /^https:\/\/[a-z0-9-]+\.cdn\.prod\.atlassian-dev\.net$|^http:\/\/localhost(:\d+)?$/;

const BASE_HEADERS = 'Content-Type, Content-Encoding';
// Statsig adds headers per SDK version (statsig-event-count, statsig-retry-count, ...),
// so allow any requested header named statsig-* or content-*.
function allowedHeaders(requested) {
  const ok = (requested || '').split(',').map((x) => x.trim()).filter((x) => /^(statsig-[a-z-]+|content-(type|encoding))$/i.test(x));
  return [BASE_HEADERS, ...ok].join(', ');
}

function cors(origin, requested) {
  const h = new Headers();
  if (origin && ALLOWED_ORIGIN.test(origin)) {
    h.set('Access-Control-Allow-Origin', origin);
    h.set('Vary', 'Origin');
    h.set('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    h.set('Access-Control-Allow-Headers', allowedHeaders(requested));
    h.set('Access-Control-Allow-Credentials', 'true');
    h.set('Access-Control-Max-Age', '86400');
  }
  return h;
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin, request.headers.get('Access-Control-Request-Headers')) });
    const upstream = UPSTREAM[url.pathname];
    if (!upstream) return new Response('not found', { status: 404 });
    const headers = new Headers(request.headers);
    headers.delete('host'); headers.delete('cookie');
    const resp = await fetch(upstream + url.search, {
      method: request.method, headers, body: request.method === 'GET' ? undefined : request.body,
    });
    const out = new Headers(resp.headers);
    for (const [k, v] of cors(origin)) out.set(k, v);
    return new Response(resp.body, { status: resp.status, headers: out });
  },
};
