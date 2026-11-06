-- Which tenant a mirrored diagram belongs to.
--
-- CustomContent carried appId and spaceId but never a cloudId, so a per-tenant
-- corpus had to be reached through DiagramAudience (view-time rows). That path
-- covers Lite well and Diagramly badly: of 504 current Diagramly sequence
-- diagrams on 2026-08-28, 2 could be attributed to a tenant. The Architecture
-- Tokens index is partitioned by cloudId, so an unattributable diagram cannot
-- be indexed for anyone.
--
-- Schema only. The backfill is 0023: a correlated subquery here read
-- DiagramAudience once per CustomContent row — 63,154 x 4,654 with no index on
-- the audience side — and D1 aborted the migration (code 7500, prod deploy of
-- v2026.08.280853-diagramly). The index below is what makes that join cheap.

ALTER TABLE CustomContent ADD COLUMN cloudId TEXT;

CREATE INDEX IF NOT EXISTS idx_custom_content_cloud_id
  ON CustomContent (cloudId, appId, status);

CREATE INDEX IF NOT EXISTS idx_diagram_audience_content
  ON DiagramAudience (customContentId, forgeAppId);
