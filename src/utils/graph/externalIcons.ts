import { callRemote } from '@/utils/requestUtil';
import {
  awaitExternalIcons,
  clearExternalIconState,
  setExternalIconState,
  type IconProxyResult,
} from './externalIconState';

export { awaitExternalIcons, clearExternalIconState };
export type { IconProxyResult };

/**
 * Icons from icons.diagrams.net, shown through our backend.
 *
 * Forge's iframe CSP refuses that host and adding it to the manifest is a major
 * app version, so the viewer gets the icons from `/graph-icon-proxy` as data
 * URLs (`img-src` allows `data:`) and hands them to DrawIO's own image lookup.
 * The editor shares the request through `runIconProxy`; see editorExternalIcons.ts.
 */
const PROXY_PATH = '/graph-icon-proxy';
const URLS_PER_REQUEST = 50; // the backend's cap
const MAX_URL_LENGTH = 2048; // the backend's cap
const DEFAULT_TIMEOUT_MS = 6000;
// `;` ends a style value, `&` starts the entity of an escaped quote around an
// HTML-label <img src>, and the rest end an attribute or tag.
const ICON_URL = /https:\/\/icons\.diagrams\.net\/[^\s"'<>;&)\\]+/g;

type Viewer = {
  getImageUrl?: (url: string) => string;
  graph?: { refresh?: () => void; getLabel?: (cell: unknown) => unknown };
  diagrams?: ArrayLike<unknown>;
  xmlNode?: unknown;
};

export type Track = (name: any, props: any) => void;

export function findExternalIconUrls(xml: string): string[] {
  return [...new Set(xml.match(ICON_URL) ?? [])];
}

/**
 * The diagram XML after decoding. The stored string may be compressed and a
 * `<diagram>` body may be deflated, so a text scan of what was stored misses
 * URLs. Every page is decoded, not only the visible one: a page switch must find
 * its icons already loaded. Never throws; an undecodable page contributes nothing.
 */
export function collectDecodedGraphXml(viewer: Viewer): string {
  const w = window as any;
  const parts: string[] = [];
  const pages = Array.from(viewer.diagrams ?? []);
  try {
    if (pages.length > 0 && w.Editor?.parseDiagramNode) {
      for (const page of pages) {
        try {
          const model = w.Editor.parseDiagramNode(page);
          if (model) parts.push(w.mxUtils.getXml(model));
        } catch { /* one bad page must not hide the others */ }
      }
    } else if (viewer.xmlNode) {
      parts.push(w.mxUtils.getXml(viewer.xmlNode));
    }
  } catch { /* nothing to scan */ }
  return parts.join('\n');
}

/**
 * GraphViewer.getImageUrl is DrawIO's single image lookup: `getImageFromBundles`
 * on the graph and on the lightbox's temporary graphs both call it, and it leaves
 * https:// URLs unchanged. Override it per viewer instance (not the shared
 * prototype) and re-validate the cells so their styles are resolved again.
 */
export function installIconResolver(viewer: Viewer, icons: Map<string, string>): void {
  const original = viewer.getImageUrl;
  viewer.getImageUrl = function (this: unknown, url: string) {
    const hit = icons.get(url);
    return hit !== undefined ? hit : original ? original.call(this, url) : url;
  };
  // An <img src> inside an HTML label is plain markup, not an image style, so it
  // never reaches getImageUrl: rewrite it where the label text is produced.
  const graph = viewer.graph;
  if (graph && typeof graph.getLabel === 'function') {
    const getLabel = graph.getLabel;
    graph.getLabel = function (this: unknown, cell: unknown) {
      const label = getLabel.call(this, cell);
      if (typeof label !== 'string' || !label.includes('icons.diagrams.net')) return label;
      let out = label;
      for (const [url, dataUrl] of icons) out = out.split(url).join(dataUrl);
      return out;
    };
  }
  graph?.refresh?.();
}

async function requestIcons(urls: string[]): Promise<{ icons: Record<string, unknown>; malformed: boolean; upstreamCode?: string }> {
  const icons: Record<string, unknown> = {};
  let malformed = false;
  let upstreamCode: string | undefined;
  const chunks: string[][] = [];
  for (let i = 0; i < urls.length; i += URLS_PER_REQUEST) chunks.push(urls.slice(i, i + URLS_PER_REQUEST));
  const bodies = await Promise.all(chunks.map((chunk) => callRemote(PROXY_PATH, 'POST', { urls: chunk })));
  for (const body of bodies) {
    if (!body || typeof body !== 'object' || typeof body.icons !== 'object' || body.icons === null) malformed = true;
    else {
      Object.assign(icons, body.icons);
      const first = Object.values(body.failed ?? {})[0];
      if (!upstreamCode && typeof first === 'string') upstreamCode = first;
    }
  }
  return { icons, malformed, upstreamCode };
}

function failureCode(error: unknown): string {
  if (error instanceof TimeoutError) return 'timeout';
  const status = (error as { status?: unknown })?.status;
  return typeof status === 'number' ? `http_${status}` : 'request_failed';
}

class TimeoutError extends Error {}

/**
 * The request, timeout, validation and telemetry shared by the viewer and the
 * editor. `apply` runs with the accepted data URLs before the outcome is
 * classified; throwing there reports `apply_failed`. Never rejects.
 */
export async function runIconProxy(options: {
  urls: string[];
  surface: 'viewer' | 'editor';
  track: Track;
  timeoutMs: number;
  apply: (accepted: Map<string, string>) => void;
}): Promise<{ result: IconProxyResult; accepted: Map<string, string> }> {
  const { surface, track, timeoutMs, apply } = options;
  const found = options.urls;
  const urls = found.filter((url) => url.length <= MAX_URL_LENGTH);
  const base = { feature_area: 'macro', surface, macro_type: 'graph', external_icon_count: found.length };
  const startedAt = Date.now();
  track('graph_icon_proxy_requested', base);
  const accepted = new Map<string, string>();

  const fail = (code: string, resolved = 0, upstreamCode?: string) => {
    track('graph_icon_proxy_failed', {
      ...base,
      error_code: code,
      icon_resolved_count: resolved,
      duration_ms: Date.now() - startedAt,
      ...(upstreamCode ? { upstream_error_code: upstreamCode } : {}),
    });
    return { result: { ok: false, code } as IconProxyResult, accepted };
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  let answer: Awaited<ReturnType<typeof requestIcons>>;
  try {
    answer = await Promise.race([
      requestIcons(urls),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new TimeoutError()), timeoutMs); }),
    ]);
  } catch (error) {
    return fail(failureCode(error));
  } finally {
    clearTimeout(timer);
  }
  const asked = new Set(urls);
  for (const [url, value] of Object.entries(answer.icons)) {
    if (asked.has(url) && typeof value === 'string' && value.startsWith('data:image/')) accepted.set(url, value);
  }
  if (accepted.size > 0) {
    try {
      apply(accepted);
    } catch (error) {
      console.error('graph icon proxy: applying icons failed:', error);
      return fail('apply_failed');
    }
  }
  if (answer.malformed || (accepted.size === 0 && Object.keys(answer.icons).length > 0)) return fail('bad_response', accepted.size);
  if (accepted.size === 0) return fail('none_resolved', 0, answer.upstreamCode);
  if (accepted.size < found.length) return fail('partial', accepted.size, answer.upstreamCode);
  track('graph_icon_proxy_succeeded', { ...base, icon_resolved_count: accepted.size, duration_ms: Date.now() - startedAt });
  return { result: { ok: true }, accepted };
}

/**
 * Looks for external icons in the built viewer and, when there are any, fetches
 * and applies them. Returns null (no request, no event) for a diagram without
 * any. Otherwise returns the settled outcome, which is also registered on
 * `container` for `awaitExternalIcons`. The caller does not await it: the
 * diagram has already rendered, and a failure leaves it rendered without icons.
 */
export function startExternalIconProxy(options: {
  viewer: Viewer;
  container: Element;
  track: Track;
  timeoutMs?: number;
}): Promise<IconProxyResult> | null {
  const { viewer, container, track, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  const found = findExternalIconUrls(collectDecodedGraphXml(viewer));
  if (found.length === 0) {
    clearExternalIconState(container);
    return null;
  }
  const settled = runIconProxy({
    urls: found,
    surface: 'viewer',
    track,
    timeoutMs,
    apply: (accepted) => installIconResolver(viewer, accepted),
  }).then(({ result }) => result);
  setExternalIconState(container, settled);
  return settled;
}
