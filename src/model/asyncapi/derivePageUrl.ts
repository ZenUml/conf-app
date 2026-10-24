// Derive an absolute, navigable Confluence page URL from a Confluence v2 page
// response (`GET /wiki/api/v2/pages/{id}`).
//
// The v2 custom-content *list* endpoint the AsyncAPI dashboard searches with
// returns each record's `pageId` but no container link, so a card has no
// working page URL on its own. We look the page up separately; its `_links`
// give us what we need:
//   - `_links.base`  — absolute wiki root, e.g. https://site.atlassian.net/wiki
//   - `_links.webui` — space-relative path, e.g. /spaces/KEY/pages/123/Title
//
// Forge `router.open` needs the absolute URL (`base + webui`). Returns
// undefined when either piece is missing so callers fall back to rendering the
// page title as plain, non-clickable text instead of a dead link.

export interface PageLinks {
  base?: string
  webui?: string
}

export interface PageV2Like {
  _links?: PageLinks | null
}

export function derivePageUrl(page: PageV2Like | null | undefined): string | undefined {
  const base = page?._links?.base
  const webui = page?._links?.webui
  if (!base || !webui) return undefined
  return `${base}${webui}`
}
