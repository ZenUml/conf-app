interface Env {
  DB: D1Database;
  // Days of AnalyticsEventFact history to retain. Override per-env in wrangler.toml.
  ANALYTICS_FACT_RETENTION_DAYS?: string;
}

// AnalyticsEventFact was the dominant table in conf-zenuml-prod (~99.9% of the
// 10 GB D1 cap before the 2026-06 backlog drain). Nothing pruned it before, so it
// grew unbounded. Delete in bounded batches so a single statement never times out
// or balloons rows-written. D1 reclaims space after deletes (verified: 9.89->3.49 GB).
const ANALYTICS_FACT_DEFAULT_RETENTION_DAYS = 45;
const ANALYTICS_FACT_PURGE_BATCH_SIZE = 50000;
// Cap rows removed per nightly run (batch x maxBatches). Large enough to drain a
// historical backlog over a few nights, bounded so the cron stays well within limits.
const ANALYTICS_FACT_PURGE_MAX_BATCHES = 40;
const FEEDBACK_ATTACHMENT_PURGE_BATCH_SIZE = 100;
const OAUTH_REFRESH_STATE_PURGE_BATCH_SIZE = 1000;

export async function purgeExpiredFeedbackScreenshots(
  db: D1Database,
  now: string,
): Promise<number> {
  const result = await db.prepare(
    `UPDATE FeedbackReport
        SET screenshotData = NULL,
            screenshotContentType = NULL,
            screenshotExpiresAt = NULL
      WHERE reportReference IN (
        SELECT reportReference
          FROM FeedbackReport
         WHERE screenshotData IS NOT NULL
           AND screenshotExpiresAt <= ?1
         LIMIT ?2
      )`,
  ).bind(now, FEEDBACK_ATTACHMENT_PURGE_BATCH_SIZE).run();
  return result.meta.changes || 0;
}

export interface OAuthRefreshStatePurgeCounts {
  receiptsStripped: number;
  tokensDeleted: number;
  chainsDeleted: number;
}

/**
 * Remove expired OAuth replay receipts and token state in bounded batches.
 * Receipt encryption material becomes eligible for clearing on the next
 * scheduled purge after its replay window closes, while the token row's
 * nonce/hash metadata remains until token expiry so reuse detection can still
 * reject an old token. Any remaining child token protects its chain marker
 * until the bounded token cleanup removes that child.
 */
export async function purgeExpiredOAuthRefreshState(
  db: D1Database,
  nowMs: number,
): Promise<OAuthRefreshStatePurgeCounts> {
  const receipts = await db.prepare(
    `UPDATE AgentLinkOAuthRefreshToken
        SET receiptCiphertext = NULL,
            receiptIv = NULL,
            receiptExpiresAtMs = NULL
      WHERE rowid IN (
        SELECT rowid
          FROM AgentLinkOAuthRefreshToken
         WHERE receiptCiphertext IS NOT NULL
           AND receiptExpiresAtMs <= ?1
         LIMIT ?2
      )`,
  ).bind(nowMs, OAUTH_REFRESH_STATE_PURGE_BATCH_SIZE).run();

  const tokens = await db.prepare(
    `DELETE FROM AgentLinkOAuthRefreshToken
      WHERE rowid IN (
        SELECT rowid
          FROM AgentLinkOAuthRefreshToken
         WHERE expiresAtMs <= ?1
           AND (receiptCiphertext IS NULL OR receiptExpiresAtMs <= ?1)
         LIMIT ?2
      )`,
  ).bind(nowMs, OAUTH_REFRESH_STATE_PURGE_BATCH_SIZE).run();

  const chains = await db.prepare(
    `DELETE FROM AgentLinkOAuthRefreshChain
      WHERE rowid IN (
        SELECT c.rowid
          FROM AgentLinkOAuthRefreshChain AS c
         WHERE c.expiresAtMs <= ?1
           AND NOT EXISTS (
             SELECT 1
               FROM AgentLinkOAuthRefreshToken AS t
              WHERE t.issuer = c.issuer
                AND t.chainId = c.chainId
           )
         LIMIT ?2
      )`,
  ).bind(nowMs, OAUTH_REFRESH_STATE_PURGE_BATCH_SIZE).run();

  return {
    receiptsStripped: receipts.meta.changes || 0,
    tokensDeleted: tokens.meta.changes || 0,
    chainsDeleted: chains.meta.changes || 0,
  };
}

export default {
  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    console.log(
      `Cron triggered at ${new Date(controller.scheduledTime).toISOString()}`
    );

    // Purge AnalyticsEventFact beyond the retention window, in bounded batches.
    const retentionDays =
      Number(env.ANALYTICS_FACT_RETENTION_DAYS) ||
      ANALYTICS_FACT_DEFAULT_RETENTION_DAYS;
    const cutoffDate = new Date(
      controller.scheduledTime - retentionDays * 86_400_000
    )
      .toISOString()
      .slice(0, 10); // YYYY-MM-DD, matches AnalyticsEventFact.eventDate

    let factDeleted = 0;
    for (let batch = 0; batch < ANALYTICS_FACT_PURGE_MAX_BATCHES; batch++) {
      // D1 SQLite is not built with DELETE ... LIMIT, so bound via an id subquery.
      const factPurge = await env.DB.prepare(
        `DELETE FROM AnalyticsEventFact WHERE id IN (
           SELECT id FROM AnalyticsEventFact WHERE eventDate < ?1 LIMIT ?2
         )`
      )
        .bind(cutoffDate, ANALYTICS_FACT_PURGE_BATCH_SIZE)
        .run();
      const deleted = factPurge.meta.changes || 0;
      factDeleted += deleted;
      if (deleted < ANALYTICS_FACT_PURGE_BATCH_SIZE) break;
    }

    console.log(
      `Purged AnalyticsEventFact (eventDate < ${cutoffDate}, ${retentionDays}d): ${factDeleted} rows deleted`
    );

    const feedbackAttachmentsDeleted = await purgeExpiredFeedbackScreenshots(
      env.DB,
      new Date(controller.scheduledTime).toISOString(),
    );
    console.log(`Purged expired feedback attachments: ${feedbackAttachmentsDeleted}`);

    const oauthRefreshState = await purgeExpiredOAuthRefreshState(
      env.DB,
      controller.scheduledTime,
    );
    console.log(
      `Purged expired OAuth refresh state: ${oauthRefreshState.receiptsStripped} receipts stripped, ${oauthRefreshState.tokensDeleted} tokens deleted, ${oauthRefreshState.chainsDeleted} chains deleted`,
    );
  },
};
