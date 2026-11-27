// stats.zenuml.com — forwards Microsoft Clarity uploads so the Forge app only
// talks to *.zenuml.com (already in the manifest; an added egress host would
// make a major Forge version that every site admin must approve).
//
//   GET  /clarity/allow    -> {"allow": boolean} from the visitor's country
//   POST /clarity/collect  -> https://s.clarity.ms/collect (dropped with 204
//                             for a blocked country, as a second check)
//
// Visitors in the EEA, UK and Switzerland are never recorded, and an unknown
// country counts as blocked. Only content headers are forwarded: no cookie,
// no user agent, no client IP header.

const CLARITY_COLLECT = "https://s.clarity.ms/collect";

// EU-27 + Iceland, Liechtenstein, Norway (EEA), United Kingdom, Switzerland.
export const BLOCKED_COUNTRIES = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU",
  "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES",
  "SE", "IS", "LI", "NO", "GB", "CH",
]);

export function isAllowedCountry(country: string | null | undefined): boolean {
  if (!country || !/^[A-Z]{2}$/.test(country) || country === "XX" || country === "T1") return false;
  return !BLOCKED_COUNTRIES.has(country);
}

const ALLOWED_ORIGIN = /^https:\/\/[a-z0-9-]+\.cdn\.prod\.atlassian-dev\.net$|^http:\/\/localhost(:\d+)?$/;
const FORWARDED_HEADERS = ["content-type", "content-encoding", "accept"];

export function corsHeaders(origin: string | null): Headers {
  const h = new Headers();
  if (origin && ALLOWED_ORIGIN.test(origin)) {
    h.set("Access-Control-Allow-Origin", origin);
    h.set("Vary", "Origin");
    h.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    h.set("Access-Control-Allow-Headers", "Content-Type, Content-Encoding, Accept");
    // clarity-js uploads with XHR withCredentials = true.
    h.set("Access-Control-Allow-Credentials", "true");
    h.set("Access-Control-Max-Age", "86400");
  }
  return h;
}

function countryOf(request: Request): string | undefined {
  return (request as Request & { cf?: { country?: string } }).cf?.country;
}

export async function handle(request: Request, upstream: typeof fetch = fetch): Promise<Response> {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  const cors = corsHeaders(origin);

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  if (url.pathname === "/clarity/allow" && request.method === "GET") {
    cors.set("Content-Type", "application/json");
    cors.set("Cache-Control", "no-store");
    return new Response(JSON.stringify({ allow: isAllowedCountry(countryOf(request)) }), { headers: cors });
  }

  if (url.pathname === "/clarity/collect" && request.method === "POST") {
    if (!isAllowedCountry(countryOf(request))) return new Response(null, { status: 204, headers: cors });
    const headers = new Headers();
    for (const name of FORWARDED_HEADERS) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    const resp = await upstream(CLARITY_COLLECT + url.search, { method: "POST", headers, body: request.body });
    const out = new Headers();
    const type = resp.headers.get("content-type");
    if (type) out.set("Content-Type", type);
    for (const [k, v] of cors) out.set(k, v);
    return new Response(resp.body, { status: resp.status, headers: out });
  }

  return new Response("not found", { status: 404 });
}

export default { fetch: (request: Request) => handle(request) };
