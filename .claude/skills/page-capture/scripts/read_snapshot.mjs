#!/usr/bin/env node
// Read a captured page snapshot by domain — no cloudId/contentId required.
// Resolves domain -> cloudId (searching both staging and production D1),
// lists what's actually in R2 for that tenant, and if the domain maps to
// more than one page ever captured, lists the candidates instead of
// guessing which one you want. Prints a summary by default; pass --full to
// include the captured page body (can be large).
//
//   node .claude/skills/page-capture/scripts/read_snapshot.mjs --domain airwallex
//   node .claude/skills/page-capture/scripts/read_snapshot.mjs --domain airwallex --content-id 141000755
//   node .claude/skills/page-capture/scripts/read_snapshot.mjs --domain airwallex --content-id 141000755 --version 5
//   node .claude/skills/page-capture/scripts/read_snapshot.mjs --domain airwallex --content-id 141000755 --full

import { APPS, d1Query, r2ListObjects, r2ObjectGet } from './lib.mjs';

const APP_ID_TO_VARIANT = Object.fromEntries(Object.entries(APPS).map(([k, v]) => [v, k]));

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--domain') out.domain = argv[++i];
    else if (a === '--content-id') out.contentId = argv[++i];
    else if (a === '--version') out.version = Number(argv[++i]);
    else if (a === '--full') out.full = true;
  }
  return out;
}

function output(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
}

const { domain, contentId, version, full } = parseArgs(process.argv.slice(2));
if (!domain) throw new Error('--domain is required');

// 1. Resolve domain -> cloudId across both environments.
const installs = [];
for (const env of ['production', 'staging']) {
  const rows = d1Query(env, `SELECT DISTINCT clientDomain, cloudId, appId FROM ForgeInstallation WHERE clientDomain LIKE '${domain.replace(/'/g, "''")}%'`);
  for (const row of rows) installs.push({ env, ...row, variant: APP_ID_TO_VARIANT[row.appId] ?? null });
}
if (!installs.length) {
  output({ error: 'no_installation_found', domain });
  process.exit(0);
}

// 2. Discover what's actually in R2 for each matched cloudId.
const candidates = [];
for (const install of installs) {
  const objects = await r2ListObjects(`page-snapshots/${install.cloudId}/`);
  const contentIds = [...new Set(objects.map((o) => o.key.split('/')[2]))];
  const filtered = contentId ? contentIds.filter((c) => c === contentId) : contentIds;
  if (filtered.length) candidates.push({ ...install, contentIds: filtered });
}
if (!candidates.length) {
  output({ error: 'no_snapshots_found', domain, contentIdFilter: contentId ?? null, installsChecked: installs });
  process.exit(0);
}

const pairs = candidates.flatMap((c) => c.contentIds.map((cid) => ({ ...c, contentId: cid })));
if (pairs.length > 1) {
  output({
    needsSelection: true,
    domain,
    candidates: candidates.map((c) => ({ env: c.env, clientDomain: c.clientDomain, variant: c.variant, cloudId: c.cloudId, contentIds: c.contentIds })),
  });
  process.exit(0);
}

// 3. Exactly one (cloudId, contentId) — resolve the version.
const target = pairs[0];
const versionObjects = await r2ListObjects(`page-snapshots/${target.cloudId}/${target.contentId}/`);
const versions = versionObjects
  .map((o) => ({ n: Number(o.key.split('/').pop().replace(/^v(\d+)\.json$/, '$1')), lastModified: o.last_modified }))
  .sort((a, b) => a.n - b.n);
if (!versions.length) {
  output({ error: 'no_versions_found', domain, cloudId: target.cloudId, contentId: target.contentId });
  process.exit(0);
}
const chosen = version ? versions.find((v) => v.n === version) : versions[versions.length - 1];
if (!chosen) {
  output({ error: 'version_not_found', domain, cloudId: target.cloudId, contentId: target.contentId, requestedVersion: version, availableVersions: versions.map((v) => v.n) });
  process.exit(0);
}

const key = `page-snapshots/${target.cloudId}/${target.contentId}/v${chosen.n}.json`;
const snapshot = r2ObjectGet(key);

const summary = {
  domain,
  env: target.env,
  variant: target.variant,
  cloudId: target.cloudId,
  contentId: target.contentId,
  key,
  availableVersions: versions.map((v) => v.n),
  contentTitle: snapshot.contentTitle,
  contentType: snapshot.contentType,
  versionNumber: snapshot.versionNumber,
  versionWhen: snapshot.versionWhen,
  versionBy: snapshot.versionBy,
  spaceKey: snapshot.spaceKey,
  spaceName: snapshot.spaceName,
  capturedAt: snapshot.capturedAt,
  bodyRepresentation: snapshot.body?.representation ?? null,
  bodyBytes: snapshot.body?.value ? Buffer.byteLength(snapshot.body.value, 'utf8') : 0,
};

output(full ? { ...summary, body: snapshot.body } : { ...summary, bodyOmitted: true, note: 'rerun with --full to include body.value' });
