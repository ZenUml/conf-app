// Fetch a macro's stored body via the Confluence v2 API and return it parsed.
// Paste into Playwright MCP `browser_evaluate` or claude-in-chrome
// `javascript_tool` after navigating to ANY page on the same tenant. Uses
// page cookies — no API token required.
//
// IMPORTANT: replace `<CC_ID>` below with the customContentId (a string).
//   `find-macros-on-page`'s snippet returns these.
//
// Returns: { ok, contentType, title, body: { diagramType, graphXml | code | spec, ... } }
//
// Notes:
//   - Works for arbitrary body sizes via Playwright MCP (no proxy filter).
//   - Via claude-in-chrome, the proxy may block base64-shaped output. If so,
//     stash on `window.__macroBody`, focus the tab, and `navigator.clipboard
//     .writeText(window.__macroBody)` — then `pbpaste > file` on the host.

(async () => {
  const CC_ID = "<CC_ID>"; // e.g. "6445039617"
  if (CC_ID === "<CC_ID>") return { err: "replace <CC_ID> with the customContentId before evaluating" };

  const r = await fetch(`/wiki/api/v2/custom-content/${CC_ID}?body-format=raw`, { credentials: "include" });
  if (!r.ok) return { err: `HTTP ${r.status} on /custom-content/${CC_ID}`, detail: await r.text() };
  const j = await r.json();

  const raw = j.body?.raw?.value;
  let body = null;
  let parseErr = null;
  try { body = JSON.parse(raw); } catch (e) { parseErr = String(e); }

  // For quick visual inspection, summarise body without spilling huge strings.
  const summary = {};
  if (body) {
    for (const k of Object.keys(body)) {
      const v = body[k];
      if (typeof v === "string") summary[k] = { type: "string", len: v.length, first120: v.slice(0, 120) };
      else summary[k] = v;
    }
  }

  // Stash full body on window for follow-up steps (clipboard, save, etc.)
  window.__macroBody = raw;
  window.__macroBodyParsed = body;

  return {
    ok: true,
    contentType: (j.type || "").split(":").pop(),
    title: j.title,
    rawLen: raw?.length ?? 0,
    parseErr,
    summary,
    // The full body is on window.__macroBody / window.__macroBodyParsed.
    // Return it inline only if small enough that the proxy filter is unlikely to bite.
    full: raw && raw.length < 4000 ? body : null,
  };
})();
