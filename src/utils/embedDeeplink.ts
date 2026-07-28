// Deeplink shape is locked by the autoConvert matcher in manifest.yml. Each
// variant's matcher points at its own backend host — multi-host since the
// #382 Phase 1 migration: lite + diagramly ride conf-lite.zenuml.com, full
// rides conf-full.zenuml.com. confluence.zenuml.com is the retired
// standalone-Worker host, still accepted during the Phase 1->3 transition
// (see docs/superpowers/specs/2026-07-28-deeplink-serving-pages-migration-design.md).
// cloudId = site UUID; contentId = numeric Confluence custom-content id.
export interface EmbedDeeplink {
  cloudId: string;
  contentId: string;
}

const DEEPLINK_RE =
  /^https:\/\/(?:confluence|conf-lite|conf-full)\.zenuml\.com\/d\/([0-9a-fA-F-]{32,36})\/(\d+)\/?(?:[?#].*)?$/;

export function parseEmbedDeeplink(url: string): EmbedDeeplink | undefined {
  const m = DEEPLINK_RE.exec((url || '').trim());
  return m ? { cloudId: m[1].toLowerCase(), contentId: m[2] } : undefined;
}
