CREATE TABLE IF NOT EXISTS TargetedSurveyResponse (
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
  UNIQUE (surveyUuid, cloudId, accountId)
);

CREATE INDEX IF NOT EXISTS idx_targeted_survey_response_created_at
  ON TargetedSurveyResponse(createdAt);
