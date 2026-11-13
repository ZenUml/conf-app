/**
 * True for the page banner's own iframe, false for a modal it opened: a modal
 * keeps the banner's moduleKey, and it must reach the editor instead of the
 * banner route, which closes the iframe when it has nothing to show.
 */
export function isPageBannerHost(context: { moduleKey?: string; extension?: { modal?: { macroMode?: string } } } | undefined): boolean {
  return context?.moduleKey === 'zenuml-page-banner' && !context.extension?.modal?.macroMode
}
