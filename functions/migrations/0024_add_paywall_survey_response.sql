-- Answers to the in-modal pricing survey shown on the Lite paywall's
-- "Request extension" path, plus the outcome of the 15-day space license the
-- survey grants on completion.
--
-- One row per survey attempt, keyed by a client-minted responseId so the
-- frontend can POST partial answers as the user types: an abandoned survey is
-- a row with submitted = 0, which is the only way to see WHERE people drop out
-- (the price battery is the expensive question). Mixpanel carries the same
-- funnel but drops free text by design, so `comment` lives here and only here.
--
-- grantStatus/grantExpiresAt record what the license write actually did
-- ('granted' | 'existing' | 'already_granted' | 'error'), so a survey that was
-- completed but never rewarded is recoverable from this table alone.

CREATE TABLE IF NOT EXISTS PaywallSurveyResponse (
  responseId TEXT PRIMARY KEY,
  cloudId TEXT NOT NULL,
  clientDomain TEXT,
  spaceKey TEXT NOT NULL,
  userAccountId TEXT NOT NULL,
  macroCount INTEGER,
  appVersion TEXT,
  role TEXT,
  priceTooCheap INTEGER,
  priceBargain INTEGER,
  priceExpensive INTEGER,
  priceTooExpensive INTEGER,
  unitMost TEXT,
  unitLeast TEXT,
  blocker TEXT,
  comment TEXT,
  submitted INTEGER NOT NULL DEFAULT 0,
  grantStatus TEXT,
  grantExpiresAt TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_paywall_survey_tenant_space ON PaywallSurveyResponse (cloudId, spaceKey);
CREATE INDEX IF NOT EXISTS idx_paywall_survey_user ON PaywallSurveyResponse (userAccountId);
CREATE INDEX IF NOT EXISTS idx_paywall_survey_submitted ON PaywallSurveyResponse (submitted, createdAt);
