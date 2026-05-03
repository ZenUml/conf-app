-- Migration number: 0014 	 2026-04-25T00:00:00.000Z

DROP VIEW IF EXISTS AnalyticsReportInstalledUninstalled;
CREATE VIEW AnalyticsReportInstalledUninstalled AS
SELECT eventDate, event, SUM(eventCount) AS eventCount
FROM AnalyticsDailyEventSummary
WHERE event IN ('installed', 'uninstalled')
GROUP BY eventDate, event;

DROP VIEW IF EXISTS AnalyticsReportCsatAverage;
CREATE VIEW AnalyticsReportCsatAverage AS
SELECT eventDate, clientDomain, isLite, responseCount, averageCsat, minimumCsat, maximumCsat
FROM AnalyticsDailyCsat;

DROP VIEW IF EXISTS AnalyticsReportActiveClientsViewSaveWeekly;
CREATE VIEW AnalyticsReportActiveClientsViewSaveWeekly AS
SELECT weekStart, event, activeClients
FROM AnalyticsWeeklyClientActivity
WHERE scope = 'all';

DROP VIEW IF EXISTS AnalyticsReportActiveClientsViewSaveFullWeekly;
CREATE VIEW AnalyticsReportActiveClientsViewSaveFullWeekly AS
SELECT weekStart, event, activeClients
FROM AnalyticsWeeklyClientActivity
WHERE scope = 'full';

DROP VIEW IF EXISTS AnalyticsReportAllEventsUniqueUsersDaily;
CREATE VIEW AnalyticsReportAllEventsUniqueUsersDaily AS
SELECT eventDate, COUNT(DISTINCT canonicalUserId) AS uniqueUsers
FROM AnalyticsEventFact
WHERE canonicalUserId IS NOT NULL
GROUP BY eventDate;

DROP VIEW IF EXISTS AnalyticsReportViewMacroPayNetDaily;
CREATE VIEW AnalyticsReportViewMacroPayNetDaily AS
SELECT
  eventDate,
  CASE
    WHEN licenseState IS NULL OR licenseState = '' THEN 'unknown'
    WHEN LOWER(licenseState) IN ('paid', 'active', 'premium', 'enterprise', 'standard', 'pro', 'trial') THEN 'paid'
    WHEN LOWER(licenseState) IN ('free', 'community', 'none', 'unlicensed') THEN 'free'
    ELSE LOWER(licenseState)
  END AS payNet,
  COUNT(*) AS eventCount
FROM AnalyticsEventFact
WHERE event = 'view_macro'
GROUP BY eventDate, payNet;

DROP VIEW IF EXISTS AnalyticsReportMacrosPerDayExMermaid;
CREATE VIEW AnalyticsReportMacrosPerDayExMermaid AS
SELECT eventDate, SUM(eventCount) AS macroCount
FROM AnalyticsDailyEventSummary
WHERE event = 'save_macro'
  AND diagramType != 'mermaid'
GROUP BY eventDate;

DROP VIEW IF EXISTS AnalyticsReportViewMacroUniqueMacroDaily;
CREATE VIEW AnalyticsReportViewMacroUniqueMacroDaily AS
SELECT eventDate, COUNT(DISTINCT macroUuid) AS uniqueMacros
FROM AnalyticsEventFact
WHERE event = 'view_macro'
  AND macroUuid IS NOT NULL
GROUP BY eventDate;
