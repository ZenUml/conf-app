-- Fixed-window request counter for the public, sign-in-free POST /mcp/render
-- (functions/agent-link/renderRateLimit.ts). `bucket` is an HMAC of the
-- caller's address (IPv6 folded to its /64), never the address itself.
-- Rows are only useful for one window and are deleted soon after.
CREATE TABLE McpRenderRate (
  bucket TEXT NOT NULL,
  windowStart INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (bucket, windowStart)
);
CREATE INDEX idx_mcp_render_rate_window ON McpRenderRate(windowStart);
