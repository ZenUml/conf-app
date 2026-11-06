-- Site-level usage + subscription-cost snapshot, one row per (cloudId, month).
-- Lite paywall redesign phase 2 (spec item 6): the Plan-and-usage page and a
-- future JSM procurement ticket both read the SAME snapshot row, rather than
-- each recomputing usage independently.
--
-- SCHEMA ONLY in this migration -- no write path is wired yet, and no
-- historical backfill is attempted. The existing paywall-banner macro-count
-- telemetry is known to jump between reads (see the paywall skill's
-- documented count-source mismatches), so treating it as an exact monthly
-- figure without further validation would misrepresent accuracy this table
-- doesn't actually have yet. `dataCompleteness` exists so a future writer can
-- say so explicitly instead of presenting every row as equally precise.
--
-- `isFinal = 0` while the current month is still accumulating; a month-end
-- job (not yet built) flips it to 1 and the row stops changing -- this is
-- what "当前月份持续更新，月结后固定快照" in the spec means structurally.
CREATE TABLE IF NOT EXISTS SiteUsageSnapshot (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cloudId TEXT NOT NULL,
    clientDomain TEXT NOT NULL,
    yearMonth TEXT NOT NULL,              -- 'YYYY-MM', UTC
    totalMacros INTEGER NOT NULL DEFAULT 0,
    overLimitSpaceCount INTEGER NOT NULL DEFAULT 0,
    -- Subscription-cost estimate shown to a site admin. Nullable: a snapshot
    -- can exist before pricing is resolved for it.
    pricingHeadcount INTEGER,
    priceVersion TEXT,                    -- references docs/pricing-model.yml's own version, not duplicated here
    currency TEXT,
    estimatedAmount REAL,
    -- 'complete' | 'partial' | 'stale' | 'unverified' -- never claim a
    -- precision the underlying macro-count read doesn't have.
    dataCompleteness TEXT NOT NULL DEFAULT 'unverified',
    collectedAt TEXT NOT NULL,
    isFinal INTEGER NOT NULL DEFAULT 0,   -- 0 = current month, still updating; 1 = frozen after month-end
    -- The procurement JSM ticket this snapshot (and any Request-Full click
    -- that references it) is attached to. One ticket per site, reused across
    -- months and across requesters -- see spec item 5 (dedup by site, not by
    -- click). Nullable: a snapshot can exist with no ticket opened yet.
    jsmTicketKey TEXT,
    createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(cloudId, yearMonth)
);

CREATE INDEX idx_site_usage_snapshot_cloud ON SiteUsageSnapshot (cloudId, yearMonth);
CREATE INDEX idx_site_usage_snapshot_ticket ON SiteUsageSnapshot (jsmTicketKey);

-- Per-space breakdown for one snapshot row (spec item 2: "空间宏数量、超限空间及近期活跃情况").
-- Normalized rather than a JSON blob so a per-space over-limit list can be
-- queried/sorted without deserializing every snapshot.
CREATE TABLE IF NOT EXISTS SiteUsageSnapshotSpace (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshotId INTEGER NOT NULL REFERENCES SiteUsageSnapshot(id),
    spaceKey TEXT NOT NULL,
    macroCount INTEGER NOT NULL DEFAULT 0,
    isOverLimit INTEGER NOT NULL DEFAULT 0,
    lastActivityAt TEXT,                  -- nullable: no recent create/edit observed
    UNIQUE(snapshotId, spaceKey)
);

CREATE INDEX idx_site_usage_snapshot_space_snapshot ON SiteUsageSnapshotSpace (snapshotId);
