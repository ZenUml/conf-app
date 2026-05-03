-- Migration number: 0013 	 2026-04-25T00:00:00.000Z

CREATE TABLE IF NOT EXISTS AnalyticsEventFact (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    eventId TEXT NOT NULL UNIQUE,
    event TEXT NOT NULL,
    action TEXT NOT NULL,
    sourceType TEXT NOT NULL,
    eventTime TEXT NOT NULL,
    eventDate TEXT NOT NULL,
    canonicalUserId TEXT,
    distinctId TEXT,
    userAccountId TEXT,
    clientDomain TEXT,
    confluenceSpace TEXT,
    contentId TEXT,
    macroUuid TEXT,
    diagramType TEXT,
    eventCategory TEXT,
    eventLabel TEXT,
    cloudId TEXT,
    isLite INTEGER,
    addonKey TEXT,
    appVersion TEXT,
    eventSource TEXT,
    licenseState TEXT,
    r2Key TEXT NOT NULL,
    createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_analytics_fact_date ON AnalyticsEventFact (eventDate);
CREATE INDEX IF NOT EXISTS idx_analytics_fact_event ON AnalyticsEventFact (event);
CREATE INDEX IF NOT EXISTS idx_analytics_fact_client ON AnalyticsEventFact (clientDomain);
CREATE INDEX IF NOT EXISTS idx_analytics_fact_user ON AnalyticsEventFact (canonicalUserId);
CREATE INDEX IF NOT EXISTS idx_analytics_fact_macro ON AnalyticsEventFact (macroUuid);
CREATE INDEX IF NOT EXISTS idx_analytics_fact_diagram ON AnalyticsEventFact (diagramType);
CREATE INDEX IF NOT EXISTS idx_analytics_fact_lite ON AnalyticsEventFact (isLite);

CREATE TABLE IF NOT EXISTS AnalyticsDailyEventSummary (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    eventDate TEXT NOT NULL,
    event TEXT NOT NULL,
    clientDomain TEXT NOT NULL DEFAULT '',
    confluenceSpace TEXT NOT NULL DEFAULT '',
    diagramType TEXT NOT NULL DEFAULT '',
    eventCategory TEXT NOT NULL DEFAULT '',
    isLite INTEGER NOT NULL DEFAULT -1,
    eventCount INTEGER NOT NULL DEFAULT 0,
    uniqueUsers INTEGER NOT NULL DEFAULT 0,
    uniqueClients INTEGER NOT NULL DEFAULT 0,
    uniqueSpaces INTEGER NOT NULL DEFAULT 0,
    uniqueContents INTEGER NOT NULL DEFAULT 0,
    uniqueMacros INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_analytics_daily_summary
    ON AnalyticsDailyEventSummary (eventDate, event, clientDomain, confluenceSpace, diagramType, eventCategory, isLite);

CREATE TABLE IF NOT EXISTS AnalyticsWeeklyClientActivity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    weekStart TEXT NOT NULL,
    event TEXT NOT NULL,
    scope TEXT NOT NULL,
    activeClients INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_analytics_weekly_clients
    ON AnalyticsWeeklyClientActivity (weekStart, event, scope);

CREATE TABLE IF NOT EXISTS AnalyticsDailyCsat (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    eventDate TEXT NOT NULL,
    clientDomain TEXT NOT NULL DEFAULT '',
    isLite INTEGER NOT NULL DEFAULT -1,
    responseCount INTEGER NOT NULL DEFAULT 0,
    averageCsat REAL,
    minimumCsat REAL,
    maximumCsat REAL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_analytics_daily_csat
    ON AnalyticsDailyCsat (eventDate, clientDomain, isLite);

CREATE TABLE IF NOT EXISTS AnalyticsSavedQuery (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    description TEXT,
    configJson TEXT NOT NULL,
    createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
