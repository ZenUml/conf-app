interface Env {
  DB: D1Database;
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

    // Aggregate raw events into daily counters (all complete days before today)
    const aggregateResult = await env.DB.prepare(
      `
      INSERT INTO DailyBehaviorCounter (date, cloudId, clientDomain, spaceKey, action, eventCount, uniqueUsers, uniquePages, updatedAt)
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
        updatedAt = CURRENT_TIMESTAMP
    `
    ).run();

    console.log(
      `Aggregated: ${aggregateResult.meta.changes} counter rows upserted`
    );

    // Purge raw events older than 60 days
    const purgeResult = await env.DB.prepare(
      `DELETE FROM UserBehaviorEvent WHERE createdAt < datetime('now', '-60 days')`
    ).run();

    console.log(`Purged: ${purgeResult.meta.changes} old events deleted`);
  },
};
