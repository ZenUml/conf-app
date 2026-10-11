-- A lease is shared by Lite and Full and can be reclaimed after expiry.
-- Terminal outcomes are permanent only for this campaign revision.
CREATE TABLE TargetedSurveyLease (
  surveyUuid TEXT NOT NULL,
  surveyRevision INTEGER NOT NULL,
  cloudId TEXT NOT NULL,
  accountId TEXT NOT NULL,
  forgeAppId TEXT NOT NULL,
  claimToken TEXT NOT NULL,
  expiresAtMs INTEGER NOT NULL,
  terminal TEXT CHECK (terminal IN ('shown', 'dismissed', 'submitted')),
  PRIMARY KEY (surveyUuid, surveyRevision, cloudId, accountId),
  UNIQUE (claimToken)
);

-- 0029 used campaign-wide uniqueness. Responses are now unique per revision.
ALTER TABLE TargetedSurveyResponse RENAME TO TargetedSurveyResponseOld;
CREATE TABLE TargetedSurveyResponse (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  surveyUuid TEXT NOT NULL,
  surveyRevision INTEGER NOT NULL,
  cloudId TEXT NOT NULL,
  accountId TEXT NOT NULL,
  forgeAppId TEXT NOT NULL,
  submissionId TEXT NOT NULL,
  optionIds TEXT NOT NULL,
  responseText TEXT,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (surveyUuid, surveyRevision, cloudId, accountId)
);
INSERT INTO TargetedSurveyResponse
  (id, surveyUuid, surveyRevision, cloudId, accountId, forgeAppId, submissionId, optionIds, responseText, createdAt)
SELECT id, surveyUuid, surveyRevision, cloudId, accountId, forgeAppId, submissionId, optionIds, responseText, createdAt
FROM TargetedSurveyResponseOld;
DROP TABLE TargetedSurveyResponseOld;
CREATE INDEX idx_targeted_survey_response_created_at ON TargetedSurveyResponse(createdAt);
