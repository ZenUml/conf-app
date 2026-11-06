#!/usr/bin/env node
// page-capture health check — read-only. Prints one JSON object to stdout;
// no formatting, no language-specific prose (the caller renders the report).
//
//   set -a; source .env.forge.local; set +a
//   node .claude/skills/page-capture/scripts/health_check.mjs
//
// Gathers: kill-switch state (4 apps x 2 envs), allowlist source-of-truth vs
// what's actually deployed, recent R2 page-snapshots grouped by tenant, and
// three deterministic consistency checks computed from that data. See
// SKILL.md "Known design gaps" for the two static issues this does NOT
// re-check every run (shared stg/prod R2 bucket, secret-as-plain-variable).

import {
  APPS,
  CF_PROJECT,
  R2_TTL_DAYS,
  ALLOWLIST_VAR,
  forgeVariablesList,
  ghVariableGet,
  cfApiGet,
  cfAccountId,
  d1Query,
  r2ListObjects,
  splitDomains,
  daysSince,
} from './lib.mjs';

const APP_ID_TO_VARIANT = Object.fromEntries(Object.entries(APPS).map(([k, v]) => [v, k]));
const ENVS = ['staging', 'production'];
const now = Date.now();

async function killSwitchReport() {
  const report = {};
  for (const app of Object.keys(APPS)) {
    report[app] = {};
    for (const env of ENVS) {
      const vars = forgeVariablesList(env, app);
      const entry = vars.find((v) => v.key === 'PAGE_CAPTURE_ENABLED');
      const set = Boolean(entry);
      const value = entry?.value ?? null;
      report[app][env] = { set, value, effectiveOn: value !== 'false' };
    }
  }
  return report;
}

async function allowlistReport() {
  const account = cfAccountId();
  const report = {};
  for (const env of ENVS) {
    const source = ghVariableGet(ALLOWLIST_VAR[env]);
    const projects = [...new Set(Object.values(CF_PROJECT[env]))];
    const live = {};
    for (const project of projects) {
      const result = await cfApiGet(`/accounts/${account}/pages/projects/${project}`);
      const envVar = result.deployment_configs?.production?.env_vars?.PAGE_CAPTURE_ALLOWED_DOMAINS;
      live[project] = {
        value: envVar?.value ?? null,
        latestDeploymentAt: result.latest_deployment?.created_on ?? null,
      };
    }
    report[env] = { source, live };
  }
  return report;
}

async function r2SnapshotReport() {
  const objects = await r2ListObjects('page-snapshots/');
  const truncated = objects.length >= 1000;

  const byCloudId = new Map();
  for (const obj of objects) {
    const [, cloudId, contentId] = obj.key.split('/');
    if (!byCloudId.has(cloudId)) byCloudId.set(cloudId, { objectCount: 0, latestModified: null, contentIds: new Set() });
    const entry = byCloudId.get(cloudId);
    entry.objectCount += 1;
    entry.contentIds.add(contentId);
    if (!entry.latestModified || obj.last_modified > entry.latestModified) entry.latestModified = obj.last_modified;
  }

  const resolved = [];
  const unresolved = [];
  for (const [cloudId, stats] of byCloudId) {
    let hit = null;
    for (const env of ['production', 'staging']) {
      const rows = d1Query(env, `SELECT clientDomain, appId FROM ForgeInstallation WHERE cloudId = '${cloudId}' LIMIT 1`);
      if (rows.length) {
        hit = { env, clientDomain: rows[0].clientDomain, appId: rows[0].appId, variant: APP_ID_TO_VARIANT[rows[0].appId] ?? null };
        break;
      }
    }
    const record = {
      cloudId,
      objectCount: stats.objectCount,
      latestModified: stats.latestModified,
      daysSinceLatest: Number(daysSince(stats.latestModified, now).toFixed(1)),
      contentIds: [...stats.contentIds],
      resolvedIn: hit?.env ?? null,
      clientDomain: hit?.clientDomain ?? null,
      variant: hit?.variant ?? null,
    };
    (hit ? resolved : unresolved).push(record);
  }

  return {
    ttlDays: R2_TTL_DAYS,
    windowNote: `R2 objects under page-snapshots/ expire after ${R2_TTL_DAYS} days — this reflects only what has not yet expired, not full history.`,
    objectCount: objects.length,
    truncated,
    byCloudId: [...resolved, ...unresolved],
  };
}

function resolveAllowlistDomains(env, domains) {
  if (!domains.length) return [];
  const conditions = domains.map((d) => `fi.clientDomain LIKE '${d.replace(/'/g, "''")}%'`).join(' OR ');
  const sql = `SELECT DISTINCT fi.clientDomain, fi.cloudId, fi.appId FROM ForgeInstallation fi WHERE ${conditions}`;
  return d1Query(env, sql).map((row) => ({ ...row, variant: APP_ID_TO_VARIANT[row.appId] ?? null }));
}

function computeChecks(killSwitches, allowlist, r2) {
  const killSwitchBlocksAllowlistedDomain = [];
  const allowlistedNoRecentCapture = [];
  const r2ByCloudId = new Map(r2.byCloudId.map((r) => [r.cloudId, r]));

  for (const env of ENVS) {
    const domains = splitDomains(allowlist[env].source);
    const installs = resolveAllowlistDomains(env, domains);
    for (const install of installs) {
      if (!install.variant) continue; // domain configured but no matching installation on record
      const killSwitch = killSwitches[install.variant][env];
      if (!killSwitch.effectiveOn) {
        killSwitchBlocksAllowlistedDomain.push({
          env,
          domain: install.clientDomain,
          variant: install.variant,
          killSwitchValue: killSwitch.value,
        });
        continue; // blocked at the switch — a capture-recency check would be redundant
      }
      const r2Entry = r2ByCloudId.get(install.cloudId);
      const hasRecent = r2Entry && r2Entry.daysSinceLatest <= R2_TTL_DAYS;
      if (!hasRecent) {
        allowlistedNoRecentCapture.push({
          env,
          domain: install.clientDomain,
          variant: install.variant,
          cloudId: install.cloudId,
          reason: r2Entry ? 'stale' : 'no_record_in_retention_window',
        });
      }
    }
  }

  const allowlistDrift = [];
  for (const env of ENVS) {
    const sourceSet = new Set(splitDomains(allowlist[env].source));
    for (const [project, data] of Object.entries(allowlist[env].live)) {
      const liveSet = new Set(splitDomains(data.value));
      const missingFromLive = [...sourceSet].filter((d) => !liveSet.has(d));
      const extraInLive = [...liveSet].filter((d) => !sourceSet.has(d));
      if (missingFromLive.length || extraInLive.length) {
        allowlistDrift.push({
          env,
          project,
          missingFromLive,
          extraInLive,
          liveDeployedAt: data.latestDeploymentAt,
        });
      }
    }
  }

  return { killSwitchBlocksAllowlistedDomain, allowlistedNoRecentCapture, allowlistDrift };
}

const [killSwitches, allowlist, r2] = await Promise.all([killSwitchReport(), allowlistReport(), r2SnapshotReport()]);
const checks = computeChecks(killSwitches, allowlist, r2);

process.stdout.write(JSON.stringify({ generatedAtMs: now, killSwitches, allowlist, r2, checks }, null, 2) + '\n');
