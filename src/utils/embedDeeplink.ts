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

// Mint side (task 6): which host a variant's minted deeplink points at, keyed
// off the SAME build-time PRODUCT_TYPE (import.meta.env.PRODUCT_TYPE) that
// selects the variant's manifest autoConvert matcher — lite and diagramly
// share the multi-tenant conf-lite Worker, full gets its own. asyncapi has no
// deeplink affordance yet (its viewer doesn't route through GenericViewer),
// so it returns undefined and callers must treat that as "don't render the
// button" rather than falling back to a host.
export function deeplinkHostForProductType(productType: string | undefined): string | undefined {
  switch (productType) {
    case 'lite':
    case 'diagramly':
      return 'conf-lite.zenuml.com';
    case 'full':
      return 'conf-full.zenuml.com';
    default:
      return undefined;
  }
}

// Bare deeplink URL builder — no ticket, no query params (see the module
// comment: the ticketed `/deeplink-ticket` share-preview surface is owned by
// other PRs). Intentionally the exact inverse of DEEPLINK_RE above.
export function buildEmbedDeeplink(host: string, cloudId: string, contentId: string): string {
  return `https://${host}/d/${cloudId}/${contentId}`;
}
