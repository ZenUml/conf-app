// In-app extension request: creates a JSM customer request on the ZEN service
// desk on behalf of the customer, replacing the external portal deep-link
// (which converted at 0% — users bounced off the $299 copy and cookie banner).
//
// Auth: Forge invocation token, enforced by _middleware.ts (AUTHENTICATED_PATHS).
// JSM auth: Basic (service-account email + API token). raiseOnBehalfOf requires
// the account to have agent permission on the ZEN desk.

interface Env {
  confluence_plugin_features: KVNamespace;
  JSM_API_EMAIL: string;
  JSM_API_TOKEN: string;
  FORGE_CONTEXT?: any;
}

// ZEN service desk constants — portal/1, "ZenUML Upgrade or Extension Request"
// form (request type 9). Same target as buildExtensionRequest.ts on the frontend.
const JSM_BASE_URL = 'https://zenuml.atlassian.net';
const SERVICE_DESK_ID = '1';
const REQUEST_TYPE_ID = '9';
// "Plan you're interested in" field; 10037 = free temporary extension.
const PLAN_FIELD_ID = 'customfield_10070';
const PLAN_OPTION_FREE_EXTENSION = '10037';

// A blocked user has no reason to file more than a few requests; this guards
// the support queue against a stuck client or abuse via the endpoint.
const RATE_LIMIT_MAX_PER_DAY = 3;
const RATE_LIMIT_TTL_SECONDS = 86400;

export interface ExtensionRequestBody {
  email: string;
  clientDomain: string;
  spaceKey: string;
  macroCount: number;
  macrosLimit: number;
  macroKind: string;
  productType: string;
  appVersion: string;
  accountId: string;
  pageId: string;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function buildDescription(b: ExtensionRequestBody): string {
  return [
    'Request: Temporary Lite editing extension (submitted in-app)',
    '',
    `Client domain: ${b.clientDomain}`,
    `Space key: ${b.spaceKey}`,
    `Macro count: ${b.macroCount}`,
    `Limit: ${b.macrosLimit}`,
    `Product: ZenUML ${b.productType}`,
    `App version: ${b.appVersion}`,
    `User account ID: ${b.accountId}`,
    `Page ID: ${b.pageId}`,
    `Macro type: ${b.macroKind}`,
    '',
    'Reason:',
    'This Confluence space has reached the ZenUML Lite diagram limit and editing may be disabled. Please temporarily extend editing access while our team reviews upgrade options.',
  ].join('\n');
}

function jsmAuthHeader(env: Env): string {
  return 'Basic ' + btoa(`${env.JSM_API_EMAIL}:${env.JSM_API_TOKEN}`);
}

async function createJsmRequest(env: Env, body: ExtensionRequestBody): Promise<Response> {
  const instanceUrl = body.clientDomain.includes('.')
    ? `https://${body.clientDomain}`
    : `https://${body.clientDomain}.atlassian.net`;

  const payload = {
    serviceDeskId: SERVICE_DESK_ID,
    requestTypeId: REQUEST_TYPE_ID,
    raiseOnBehalfOf: body.email,
    requestFieldValues: {
      summary: instanceUrl,
      description: buildDescription(body),
      [PLAN_FIELD_ID]: { id: PLAN_OPTION_FREE_EXTENSION },
    },
  };

  return fetch(`${JSM_BASE_URL}/rest/servicedeskapi/request`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: jsmAuthHeader(env),
    },
    body: JSON.stringify(payload),
  });
}

// raiseOnBehalfOf fails when the email has no customer account on the desk.
// Creating the customer first is idempotent enough for our purpose: a 409
// (already exists) is treated as success.
async function ensureJsmCustomer(env: Env, email: string): Promise<boolean> {
  const res = await fetch(`${JSM_BASE_URL}/rest/servicedeskapi/customer`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: jsmAuthHeader(env),
      // Required to create customers without them existing as Atlassian accounts
      'X-ExperimentalApi': 'opt-in',
    },
    body: JSON.stringify({ email, displayName: email.split('@')[0] }),
  });
  return res.ok || res.status === 409;
}

async function checkRateLimit(
  kv: KVNamespace,
  clientDomain: string,
  accountId: string
): Promise<boolean> {
  const key = `ext-req-rate:${clientDomain}:${accountId}`;
  const raw = await kv.get(key);
  const count = raw ? parseInt(raw, 10) || 0 : 0;
  if (count >= RATE_LIMIT_MAX_PER_DAY) return false;
  // TTL resets on each put — acceptable drift for an abuse guard, not billing.
  await kv.put(key, String(count + 1), { expirationTtl: RATE_LIMIT_TTL_SECONDS });
  return true;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.JSM_API_EMAIL || !env.JSM_API_TOKEN) {
    console.error('JSM_API_EMAIL / JSM_API_TOKEN not configured');
    return jsonResponse(500, { error: 'server_configuration' });
  }

  let body: ExtensionRequestBody;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { error: 'invalid_json' });
  }

  if (!body.email || !EMAIL_RE.test(body.email)) {
    return jsonResponse(400, { error: 'invalid_email' });
  }
  if (!body.clientDomain || !body.spaceKey) {
    return jsonResponse(400, { error: 'missing_fields', message: 'clientDomain and spaceKey are required' });
  }

  // Prefer the accountId asserted by the verified Forge token over the body.
  const tokenAccountId = env.FORGE_CONTEXT?.payload?.principal?.accountId;
  const accountId = tokenAccountId || body.accountId || 'unknown';

  if (env.confluence_plugin_features) {
    const allowed = await checkRateLimit(env.confluence_plugin_features, body.clientDomain, accountId);
    if (!allowed) {
      return jsonResponse(429, { error: 'rate_limited', message: 'Too many extension requests today. Our team has your earlier request.' });
    }
  }

  let jsmRes = await createJsmRequest(env, { ...body, accountId });

  if (jsmRes.status === 400 || jsmRes.status === 404) {
    // Likely an unknown customer email — create the customer and retry once.
    const created = await ensureJsmCustomer(env, body.email);
    if (created) {
      jsmRes = await createJsmRequest(env, { ...body, accountId });
    }
  }

  if (!jsmRes.ok) {
    const errBody = await jsmRes.text();
    console.error('JSM request creation failed:', jsmRes.status, errBody);
    return jsonResponse(502, { error: 'jsm_request_failed', jsmStatus: jsmRes.status });
  }

  const created = (await jsmRes.json()) as { issueKey?: string };
  return jsonResponse(201, { issueKey: created.issueKey || null });
};

// Pages routes non-POST methods here (onRequestPost wins for POST).
export const onRequest: PagesFunction<Env> = async () =>
  jsonResponse(405, { error: 'method_not_allowed' });
