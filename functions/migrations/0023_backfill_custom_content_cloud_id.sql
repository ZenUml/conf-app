-- Backfill CustomContent.cloudId from the view-time table.
--
-- Driven from DiagramAudience (4,654 rows) into CustomContent's primary key
-- (contentId, appId), so the work is one index lookup per audience row rather
-- than a scan of the 63,154-row content table. Rows nobody has viewed keep a
-- NULL cloudId and are stamped by the next save of that diagram.

UPDATE CustomContent
SET cloudId = (
  SELECT a.cloudId
  FROM DiagramAudience a
  WHERE a.customContentId = CustomContent.contentId
    AND a.forgeAppId = CustomContent.appId
  LIMIT 1
)
WHERE cloudId IS NULL
  AND EXISTS (
    SELECT 1
    FROM DiagramAudience a
    WHERE a.customContentId = CustomContent.contentId
      AND a.forgeAppId = CustomContent.appId
  );
