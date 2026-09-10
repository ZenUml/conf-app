interface Env {
  DB: D1Database;
  FEEDBACK_ATTACHMENT_BUCKET?: R2Bucket;
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

interface ExpiredFeedbackAttachment {
  reportReference: string;
  screenshotObjectKey: string;
}

export async function purgeExpiredFeedbackAttachments(
  db: D1Database,
  bucket: R2Bucket | undefined,
  now: string,
): Promise<number> {
  if (!bucket) return 0;
  const result = await db.prepare(
    `SELECT reportReference, screenshotObjectKey
       FROM FeedbackReport
      WHERE screenshotObjectKey IS NOT NULL
        AND screenshotExpiresAt <= ?1
      LIMIT ?2`,
  ).bind(now, FEEDBACK_ATTACHMENT_PURGE_BATCH_SIZE).all<ExpiredFeedbackAttachment>();
  const expired = result.results ?? [];

  let deleted = 0;
  for (const attachment of expired) {
    try {
      await bucket.delete(attachment.screenshotObjectKey);
      await db.prepare(
        `UPDATE FeedbackReport
            SET screenshotObjectKey = NULL,
                screenshotContentType = NULL,
                screenshotExpiresAt = NULL
          WHERE reportReference = ?1 AND screenshotObjectKey = ?2`,
      ).bind(attachment.reportReference, attachment.screenshotObjectKey).run();
      deleted += 1;
    } catch {
      // Keep the metadata so the next daily run retries. Never log object keys:
      // they identify a private support report.
    }
  }
  return deleted;
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

    const feedbackAttachmentsDeleted = await purgeExpiredFeedbackAttachments(
      env.DB,
      env.FEEDBACK_ATTACHMENT_BUCKET,
      new Date(controller.scheduledTime).toISOString(),
    );
    console.log(`Purged expired feedback attachments: ${feedbackAttachmentsDeleted}`);
  },
};
