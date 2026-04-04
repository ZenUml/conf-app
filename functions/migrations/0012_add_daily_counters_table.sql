-- Daily aggregated counters for page view/update events.
-- Reduces storage cost vs keeping every raw event indefinitely.
CREATE TABLE IF NOT EXISTS DailyBehaviorCounter (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    cloudId TEXT NOT NULL,
    clientDomain TEXT,
    spaceKey TEXT,
    action TEXT NOT NULL,
    eventCount INTEGER NOT NULL DEFAULT 0,
    uniqueUsers INTEGER NOT NULL DEFAULT 0,
    uniquePages INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(date, cloudId, spaceKey, action)
);

CREATE INDEX idx_daily_counter_date ON DailyBehaviorCounter (date);
CREATE INDEX idx_daily_counter_cloud_date ON DailyBehaviorCounter (cloudId, date);
