// Confluence reports the page id of an UNPUBLISHED (draft) page as the string
// "0". It is truthy, so a bare `if (pageId)` accepts it and the id gets sent as
// a real parent — custom-content create then answers 404 "parent page 0 not
// found" (conf-app#523). A usable page id is a real, persisted one: not
// nullish, not empty/whitespace, and not the draft sentinel (string or number).
export function isUsablePageId(id: unknown): id is string | number {
  if (id === undefined || id === null) return false;
  const s = String(id).trim();
  return s !== '' && s !== '0';
}
