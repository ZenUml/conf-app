-- Temporary storage for user-authorized feedback screenshots. The API caps
-- each BLOB at 1 MiB, below D1's 2 MB per-row limit. The cron worker clears
-- image bytes after 30 days while retaining the report text and context.
ALTER TABLE FeedbackReport ADD COLUMN screenshotData BLOB;

DROP INDEX IF EXISTS idx_feedback_report_screenshot_expiry;
CREATE INDEX idx_feedback_report_screenshot_expiry
  ON FeedbackReport(screenshotExpiresAt)
  WHERE screenshotData IS NOT NULL;
