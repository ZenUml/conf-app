// Paste into Playwright MCP `browser_evaluate` or claude-in-chrome `javascript_tool`
// after navigating to ANY Confluence page on the tenant. Uses the page's own
// cookies — no API token required. Works on customer tenants the user can
// view in their browser.
//
// Returns: { renderedCount, rendered, orphans, totalCC }
// `rendered` is every ADF extension node (including third-party apps) in page
// order. Filter `moduleKey` to just `zenuml-*-macro-*` to see only our macros.

(async () => {
  // Pull the page id from the URL (works on any /wiki/spaces/.../pages/<id>/... page)
  const m = location.pathname.match(/\/pages\/(\d+)/);
  const pageId = m ? m[1] : null;
  if (!pageId) return { err: "no /pages/<id> in URL — navigate to a page first" };

  const [pageRes, ccRes] = await Promise.all([
    fetch(`/wiki/api/v2/pages/${pageId}?body-format=atlas_doc_format`, { credentials: "include" }).then(r => r.json()),
    fetch(`/wiki/api/v2/pages/${pageId}/custom-content?limit=250`, { credentials: "include" }).then(r => r.json()),
  ]);
  if (!pageRes.body) return { err: "no page body", pageRes };

  const adf = JSON.parse(pageRes.body.atlas_doc_format.value);
  const ccById = new Map((ccRes.results || []).map(c => [c.id, c]));

  const exts = [];
  (function walk(n) {
    if (!n || typeof n !== "object") return;
    if (n.type === "extension" || n.type === "bodiedExtension" || n.type === "inlineExtension") exts.push(n);
    if (Array.isArray(n.content)) for (const c of n.content) walk(c);
  })(adf);

  const rendered = exts.map((ext, i) => {
    const ccId = ext.attrs?.parameters?.guestParams?.["custom-content-id"]
              || ext.attrs?.parameters?.guestParams?.customContentId;
    const cc = ccId ? ccById.get(String(ccId)) : null;
    const key = ext.attrs?.extensionKey || "";
    return {
      pos: i + 1,
      moduleKey: key.slice(key.lastIndexOf("/") + 1),
      customContentId: ccId || null,
      title: cc?.title ?? null,
      contentType: (cc?.type || "").split(":").pop(),
      localId: ext.attrs?.parameters?.localId || "",
    };
  });

  const renderedIds = new Set(rendered.map(r => String(r.customContentId)).filter(Boolean));
  const orphans = (ccRes.results || [])
    .filter(c => !renderedIds.has(String(c.id)))
    .map(c => ({ id: c.id, type: (c.type || "").split(":").pop(), title: c.title }));

  return { renderedCount: rendered.length, rendered, orphanCount: orphans.length, orphans };
})();
