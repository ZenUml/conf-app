import { findExternalIconUrls, runIconProxy, type Track } from './externalIcons';

/**
 * External icons in the DrawIO EDITOR.
 *
 * The editor is a nested drawio/index.html iframe with no bridge and no reachable
 * graph instance, but it is same-origin. So the parent fetches the icons from our
 * backend and installs a resolver on the frame's Graph prototype BEFORE sending
 * `load`; the instance does not exist yet to refresh afterwards.
 *
 * The resolver changes display only. `postProcessCellStyle` writes the data URL
 * into the computed state style, never into the model, and `getLabel` is display
 * text: autosave, Publish and drafts still carry the original icons.diagrams.net
 * URL. Known limit: an icon added during the session stays blank until reopen,
 * because only the URLs of a loaded document are fetched.
 *
 * Editing must not depend on our backend: the wait is bounded and every failure
 * resolves, so the caller always loads.
 */
// Longer than a healthy proxy call, short enough that a slow one does not make
// the editor feel broken. The viewer allows 6 s because it never blocks on it.
const DEFAULT_WAIT_MS = 3000;

export function createEditorIconLoader(options: { track: Track; timeoutMs?: number }) {
  const { track, timeoutMs = DEFAULT_WAIT_MS } = options;
  // Shared by reference with every installed resolver, so icons fetched later
  // are visible to windows that were set up earlier.
  const icons = new Map<string, string>();
  const installed = new WeakSet<object>();

  function decodedXml(win: any, xml: string): string {
    const parts = [xml];
    try {
      const root = win.mxUtils.parseXml(xml).documentElement;
      if (root?.nodeName === 'mxfile') {
        for (const page of Array.from<any>(root.getElementsByTagName('diagram'))) {
          try {
            const model = win.Editor.parseDiagramNode(page);
            if (model) parts.push(win.mxUtils.getXml(model));
          } catch { /* one bad page must not hide the others */ }
        }
      }
    } catch { /* the raw string is still scanned */ }
    return parts.join('\n');
  }

  function install(win: any): boolean {
    const proto = (win?.Graph ?? win?.mxGraph)?.prototype;
    if (!proto) return false;
    if (installed.has(proto)) return true;
    installed.add(proto);
    const getImageFromBundles = proto.getImageFromBundles;
    proto.getImageFromBundles = function (this: unknown, url: string) {
      const hit = icons.get(url);
      return hit !== undefined ? hit : getImageFromBundles?.call(this, url);
    };
    const getLabel = proto.getLabel;
    if (typeof getLabel === 'function') {
      proto.getLabel = function (this: unknown, cell: unknown) {
        const label = getLabel.call(this, cell);
        if (typeof label !== 'string' || !label.includes('icons.diagrams.net')) return label;
        let out = label;
        for (const [url, dataUrl] of icons) out = out.split(url).join(dataUrl);
        return out;
      };
    }
    return true;
  }

  return {
    /**
     * Null when there is nothing to wait for (no external icons, all cached, or
     * the frame has no graph class). Otherwise a promise that always resolves.
     */
    prepare(win: any, xml: string): Promise<void> | null {
      if (!win || !xml) return null;
      let found: string[];
      try {
        found = findExternalIconUrls(decodedXml(win, xml));
        if (found.length === 0 || !install(win)) return null;
      } catch {
        return null;
      }
      const missing = found.filter((url) => !icons.has(url));
      if (missing.length === 0) return null;
      return runIconProxy({
        urls: missing,
        surface: 'editor',
        track,
        timeoutMs,
        apply: (accepted) => accepted.forEach((dataUrl, url) => icons.set(url, dataUrl)),
      }).then(() => undefined, () => undefined);
    },
  };
}
