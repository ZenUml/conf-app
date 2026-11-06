-- Dedicated render-only database. Same schema as functions/migrations/0035.
-- No Confluence data or diagram source belongs in this database.
CREATE TABLE McpRenderRate (
  bucket TEXT NOT NULL,
  windowStart INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (bucket, windowStart)
);
CREATE INDEX idx_mcp_render_rate_window ON McpRenderRate(windowStart);
