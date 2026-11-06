-- One irreversible claim per verified person/site/campaign across Lite and
-- Full. Both Pages projects bind the same D1 database in each environment.
CREATE TABLE IF NOT EXISTS TargetedSurveyClaim (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  surveyUuid TEXT NOT NULL,
  cloudId TEXT NOT NULL,
  accountId TEXT NOT NULL,
  forgeAppId TEXT NOT NULL,
  claimToken TEXT NOT NULL,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (surveyUuid, cloudId, accountId),
  UNIQUE (claimToken)
);
