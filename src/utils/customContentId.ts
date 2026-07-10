// A usable Confluence custom-content id is a real, non-sentinel id. The
// conf-app#320 failure mode is a save whose response carried NO id: the value
// then round-trips through `String(...)`, producing the literal strings
// "undefined" / "null" (or nullish / empty), which get written back into the
// macro config and permanently orphan the macro with no recovery path.
//
// Reject exactly those poisoned shapes — nullish, empty/whitespace, and the
// String(undefined)/String(null)/String(NaN) sentinels — while accepting any
// genuine id (real ids are numeric strings like "53696004924"). Guarding on
// this stops two things:
//   1. persisting a garbage customContentId back into the macro config, and
//   2. issuing a doomed GET /custom-content/undefined that never 404s cleanly
//      (so the orphan-recovery probe is skipped and the diagram never recovers).
export function isValidCustomContentId(id: unknown): boolean {
  if (id === undefined || id === null) return false;
  const s = String(id).trim();
  return s !== '' && s !== 'undefined' && s !== 'null' && s !== 'NaN';
}
