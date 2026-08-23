import {
  classifyMarketplaceContacts,
  persistMarketplaceContactResolutions,
} from '../../../functions/service/marketplaceContactResolution';

export interface Env {
  DB: D1Database;
  // Days of AnalyticsEventFact history to retain. Override per-env in wrangler.toml.
  ANALYTICS_FACT_RETENTION_DAYS?: string;
  // All five Marketplace values are Worker secrets/operational configuration.
  // They are intentionally absent from wrangler.toml and public source data.
  MARKETPLACE_VENDOR_EMAIL?: string;
  MARKETPLACE_VENDOR_API_TOKEN?: string;
  MARKETPLACE_VENDOR_ID?: string;
  MARKETPLACE_CONTACT_ENCRYPTION_KEY?: string;
  MARKETPLACE_KNOWN_RESELLER_DOMAINS?: string;
}

const ANALYTICS_FACT_DEFAULT_RETENTION_DAYS = 45;
const ANALYTICS_FACT_PURGE_BATCH_SIZE = 50000;
const ANALYTICS_FACT_PURGE_MAX_BATCHES = 40;
const DEFAULT_MARKETPLACE_VENDOR_ID = '1215266';

export async function runAnalyticsMaintenance(
  controller: ScheduledController,
  env: Env,
): Promise<void> {
  const aggregateResult = await env.DB.prepare(
    `INSERT INTO DailyBehaviorCounter (date, cloudId, clientDomain, spaceKey, action, eventCount, uniqueUsers, uniquePages, updatedAt)
     SELECT DATE(createdAt) as date, cloudId, clientDomain, spaceKey, action,
            COUNT(*) as eventCount,
            COUNT(DISTINCT userAccountId) as uniqueUsers,
            COUNT(DISTINCT contentId) as uniquePages,
            CURRENT_TIMESTAMP
       FROM UserBehaviorEvent
      WHERE DATE(createdAt) < DATE('now')
      GROUP BY DATE(createdAt), cloudId, clientDomain, spaceKey, action
      ON CONFLICT(date, cloudId, spaceKey, action) DO UPDATE SET
        eventCount = excluded.eventCount,
        uniqueUsers = excluded.uniqueUsers,
        uniquePages = excluded.uniquePages,
        clientDomain = COALESCE(excluded.clientDomain, DailyBehaviorCounter.clientDomain),
        updatedAt = CURRENT_TIMESTAMP`,
  ).run();
  console.log(`Aggregated: ${aggregateResult.meta.changes} counter rows upserted`);

  const purgeResult = await env.DB.prepare(
    `DELETE FROM UserBehaviorEvent WHERE createdAt < datetime('now', '-60 days')`,
  ).run();
  console.log(`Purged: ${purgeResult.meta.changes} old events deleted`);

  const retentionDays = Number(env.ANALYTICS_FACT_RETENTION_DAYS)
    || ANALYTICS_FACT_DEFAULT_RETENTION_DAYS;
  const cutoffDate = new Date(
    controller.scheduledTime - retentionDays * 86_400_000,
  ).toISOString().slice(0, 10);

  let factDeleted = 0;
  for (let batch = 0; batch < ANALYTICS_FACT_PURGE_MAX_BATCHES; batch += 1) {
    const factPurge = await env.DB.prepare(
      `DELETE FROM AnalyticsEventFact WHERE id IN (
         SELECT id FROM AnalyticsEventFact WHERE eventDate < ?1 LIMIT ?2
       )`,
    ).bind(cutoffDate, ANALYTICS_FACT_PURGE_BATCH_SIZE).run();
    const deleted = factPurge.meta.changes || 0;
    factDeleted += deleted;
    if (deleted < ANALYTICS_FACT_PURGE_BATCH_SIZE) break;
  }
  console.log(
    `Purged AnalyticsEventFact (eventDate < ${cutoffDate}, ${retentionDays}d): ${factDeleted} rows deleted`,
  );
}

function resellerDomains(value: string | undefined): Set<string> {
  return new Set((value ?? '').split(',').map((domain) => domain.trim().toLowerCase()).filter(Boolean));
}

export async function refreshMarketplaceContacts(
  controller: ScheduledController,
  env: Env,
): Promise<void> {
  const email = env.MARKETPLACE_VENDOR_EMAIL;
  const apiToken = env.MARKETPLACE_VENDOR_API_TOKEN;
  const encryptionSecret = env.MARKETPLACE_CONTACT_ENCRYPTION_KEY;
  if (!email || !apiToken || !encryptionSecret) {
    throw new Error('Marketplace contact refresh configuration is incomplete');
  }

  const vendorId = env.MARKETPLACE_VENDOR_ID || DEFAULT_MARKETPLACE_VENDOR_ID;
  const upstream = await fetch(
    `https://marketplace.atlassian.com/rest/2/vendors/${encodeURIComponent(vendorId)}/reporting/licenses/export`,
    {
      headers: {
        Authorization: `Basic ${btoa(`${email}:${apiToken}`)}`,
        Accept: 'application/json',
      },
    },
  );
  if (!upstream.ok) throw new Error(`Marketplace license export failed with HTTP ${upstream.status}`);
  const payload: unknown = await upstream.json();
  const fetchedAt = new Date(controller.scheduledTime);
  const resolutions = classifyMarketplaceContacts(payload, {
    fetchedAt,
    now: fetchedAt,
    knownResellerDomains: resellerDomains(env.MARKETPLACE_KNOWN_RESELLER_DOMAINS),
  });
  await persistMarketplaceContactResolutions(env.DB, resolutions, {
    encryptionSecret,
    now: fetchedAt,
  });
  // Aggregate-only operational evidence. Never log identifiers or contacts.
  console.log(`Marketplace contact cache refreshed: ${resolutions.length} tenant routes`);
}

interface ScheduledDependencies {
  runAnalyticsMaintenance: typeof runAnalyticsMaintenance;
  refreshMarketplaceContacts: typeof refreshMarketplaceContacts;
  logError: (code: string) => void;
}

const defaultDependencies: ScheduledDependencies = {
  runAnalyticsMaintenance,
  refreshMarketplaceContacts,
  logError: (code) => console.error(code),
};

export async function runScheduledJobs(
  controller: ScheduledController,
  env: Env,
  dependencies: ScheduledDependencies = defaultDependencies,
): Promise<{ analytics: 'completed'; marketplaceContacts: 'completed' | 'failed' }> {
  // Preserve the existing analytics authority. Contact refresh is a separate,
  // best-effort step and can never prevent aggregation or retention.
  await dependencies.runAnalyticsMaintenance(controller, env);
  try {
    await dependencies.refreshMarketplaceContacts(controller, env);
    return { analytics: 'completed', marketplaceContacts: 'completed' };
  } catch {
    dependencies.logError('marketplace_contact_refresh_failed');
    return { analytics: 'completed', marketplaceContacts: 'failed' };
  }
}

export default {
  async scheduled(
    controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    console.log(`Cron triggered at ${new Date(controller.scheduledTime).toISOString()}`);
    await runScheduledJobs(controller, env);
  },
};
