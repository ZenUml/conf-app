-- Only metadata is stored in D1. User-authorized image bytes live in the
-- private FEEDBACK_ATTACHMENT_BUCKET and expire after 30 days.
ALTER TABLE FeedbackReport ADD COLUMN screenshotObjectKey TEXT;
ALTER TABLE FeedbackReport ADD COLUMN screenshotContentType TEXT;
ALTER TABLE FeedbackReport ADD COLUMN screenshotExpiresAt TEXT;

CREATE INDEX IF NOT EXISTS idx_feedback_report_screenshot_expiry
  ON FeedbackReport(screenshotExpiresAt)
  WHERE screenshotObjectKey IS NOT NULL;
