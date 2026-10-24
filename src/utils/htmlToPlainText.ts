// Minimal HTML -> plain text for read_page (design §4.4): strip tags/scripts/
// styles, decode the handful of entities Confluence's export_view HTML
// actually emits, collapse whitespace. This is context for the agent, not a
// faithful re-render — a full HTML/ADF parser is overkill for MVP scope
// (design §12 explicitly defers ADF authoring).
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}
