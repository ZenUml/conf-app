// POST /mcp — the public, sign-in-free render MCP server's endpoint.
//
// The same server as /mcp/render (render.ts), which stays as an alias: the
// Claude directory listing and published plugin configs already point at it.
// The handler does not depend on the path it was reached by.
//
// `/mcp` must stay in public/_routes.json's include list, or Pages answers
// this path with the SPA's HTML instead of running this function.

export { onRequestOptions, onRequestGet, onRequestDelete, onRequestPost } from './render';
