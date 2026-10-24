#!/usr/bin/env node
// Read-only Connect JWT probe for a Confluence Cloud tenant that has our app
// installed (or originally installed Connect, then migrated to Forge).
//
// Confirms whether the Connect shared secret stored in our D1
// ClientInstallation table still authenticates calls to the Confluence v2
// REST API after Atlassian's Connect-from-Forge migration.
//
// Two-step recovery workflow this enables:
//   1. List custom contents on a page (this script) — find the customContentId
//      by matching macroUuid in the body.
//   2. Walk version history via /wiki/api/v2/custom-content/{id}/versions and
//      restore the last non-empty version (separate script).
//
// Usage (no secrets in shell history — paste interactively or load from a
// secrets manager):
//
//   ADDON_KEY=com.zenuml.confluence-addon-lite \
//   SHARED_SECRET='...from D1 ClientInstallation...' \
//   DOMAIN=example-tenant \
//   PAGE_ID=1234567890 \
//   node scripts/connect-jwt-probe.mjs
//
// Pull the shared secret from D1 (example):
//   npx wrangler d1 execute conf-zenuml-prod --remote --json \
//     --command "SELECT sharedSecret FROM ClientInstallation \
//       WHERE clientDomain='example-tenant' AND eventType='installed' \
//       ORDER BY timestamp DESC LIMIT 1;"

import { SignJWT } from 'jose';
import { createHash } from 'node:crypto';

const { ADDON_KEY, SHARED_SECRET, DOMAIN, PAGE_ID } = process.env;

const required = { ADDON_KEY, SHARED_SECRET, DOMAIN, PAGE_ID };
const missing = Object.entries(required).filter(([, v]) => !v).map(([k]) => k);
if (missing.length) {
  console.error(`Missing env vars: ${missing.join(', ')}`);
  console.error('See script header for usage.');
  process.exit(2);
}

const baseUrl = `https://${DOMAIN}.atlassian.net/wiki`;
const requestPath = `/api/v2/pages/${PAGE_ID}/custom-content`;

// Atlassian Connect QSH: SHA256 of `${METHOD}&${canonicalPath}&${sortedQuery}`.
// canonicalPath is the URI relative to the context path (`/wiki`).
const qsh = createHash('sha256').update(`GET&${requestPath}&`).digest('hex');

const now = Math.floor(Date.now() / 1000);
const secret = new TextEncoder().encode(SHARED_SECRET);

const token = await new SignJWT({ qsh })
  .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
  .setIssuer(ADDON_KEY)
  .setIssuedAt(now)
  .setExpirationTime(now + 60)
  .sign(secret);

const url = `${baseUrl}${requestPath}`;
console.error(`GET ${url}`);

const res = await fetch(url, {
  headers: { Authorization: `JWT ${token}`, Accept: 'application/json' },
});

console.error(`HTTP ${res.status} ${res.statusText}`);
console.error(`content-type: ${res.headers.get('content-type') ?? '(none)'}`);

const bodyText = await res.text();

if (res.ok) {
  try {
    const json = JSON.parse(bodyText);
    const results = json.results ?? [];
    console.error(`\nFound ${results.length} custom-content entries on page ${PAGE_ID}.\n`);
    for (const cc of results) {
      const id = cc.id;
      const type = cc.type ?? '(no type)';
      const title = cc.title ?? '(no title)';
      const bodyStr = typeof cc.body === 'string' ? cc.body : JSON.stringify(cc.body ?? '');
      const macroUuidMatch = bodyStr.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      const macroUuid = macroUuidMatch ? macroUuidMatch[0] : '(no uuid in body)';
      console.log(`${id}\t${type}\t${macroUuid}\t${title}`);
    }
  } catch {
    console.log(bodyText.slice(0, 4000));
  }
  process.exit(0);
}

// Auth or endpoint failure — surface what we got back.
console.error('\nNon-2xx response. First 2000 chars of body:');
console.error(bodyText.slice(0, 2000));
process.exit(1);
