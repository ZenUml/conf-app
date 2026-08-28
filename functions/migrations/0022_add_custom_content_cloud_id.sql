-- Which tenant a mirrored diagram belongs to.
--
-- CustomContent carried appId and spaceId but never a cloudId, so a per-tenant
-- corpus had to be reached through DiagramAudience (view-time rows). That path
-- covers Lite well and Diagramly badly: of 504 current Diagramly sequence
-- diagrams on 2026-08-28, 2 could be attributed to a tenant. The Architecture
-- Tokens index is partitioned by cloudId, so an unattributable diagram cannot
-- be indexed for anyone.
--
-- The save handler already derives cloudId from the Forge apiBaseUrl for
-- ForgeInstallation; this column records it on the content row as well.

ALTER TABLE CustomContent ADD COLUMN cloudId TEXT;

CREATE INDEX IF NOT EXISTS idx_custom_content_cloud_id
  ON CustomContent (cloudId, appId, status);

-- Backfill what the view-time table already knows. Rows outside it stay NULL
-- and are filled by the next save of that diagram.
UPDATE CustomContent
SET cloudId = (
  SELECT a.cloudId
  FROM DiagramAudience a
  WHERE a.customContentId = CustomContent.contentId
    AND a.forgeAppId = CustomContent.appId
  LIMIT 1
)
WHERE cloudId IS NULL;
