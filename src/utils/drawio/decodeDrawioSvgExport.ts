/**
 * Decode the SVG string from a DrawIO embed `{event:'export'}` response.
 *
 * DrawIO (EditorUi.js) answers `{action:'export', format:'svg'}` with
 *   msg.data = Editor.createSvgDataUri(svg)
 *            = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)))
 * so the inverse is decodeURIComponent(escape(atob(b64))). We also tolerate a
 * url-encoded (`;utf8,`/`;charset`) data URI and a raw `<svg>`/`<?xml>` string in
 * case a future bundle changes the encoding. Returns undefined for anything that
 * isn't a plausible SVG — Lever D is best-effort and the viewer live-renders then.
 *
 * The returned SVG is sanitized on READ (utils/mermaid/sanitizeSvg) before injection,
 * so this function does not trust or scrub content — it only decodes + shape-checks.
 */
export function decodeDrawioSvgExport(payload: unknown): string | undefined {
  try {
    const data = (payload as { data?: unknown })?.data;
    if (typeof data !== 'string' || data.length === 0) return undefined;

    const B64_PREFIX = 'data:image/svg+xml;base64,';
    if (data.startsWith(B64_PREFIX)) {
      const b64 = data.slice(B64_PREFIX.length);
      // Inverse of btoa(unescape(encodeURIComponent(svg))): base64 → bytes → UTF-8.
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const svg = new TextDecoder().decode(bytes);
      return /<svg[\s>]/i.test(svg) ? svg : undefined;
    }

    if (data.startsWith('data:image/svg+xml')) {
      // e.g. data:image/svg+xml;utf8,<svg...> or ;charset=utf-8,<svg...>
      const comma = data.indexOf(',');
      if (comma < 0) return undefined;
      const raw = decodeURIComponent(data.slice(comma + 1));
      return /<svg[\s>]/i.test(raw) ? raw : undefined;
    }

    if (/^\s*<\?xml/i.test(data) || /^\s*<svg[\s>]/i.test(data)) {
      return /<svg[\s>]/i.test(data) ? data : undefined;
    }

    return undefined;
  } catch {
    return undefined;
  }
}
