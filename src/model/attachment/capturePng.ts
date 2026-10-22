import { captureBlob } from '@/model/captureBlob';
import md5 from 'md5';
import { trackEvent } from '@/utils/window';

/** Message event data for iframe PNG export */
interface ExportResultMessageData {
  action: 'export.result';
  data: Blob;
}

// ============================================================================
// PNG Generation Functions
// ============================================================================

/**
 * Convert iframe content to PNG via postMessage.
 * Sends 'export' action to iframe and waits for 'export.result' response.
 */
export function iframeToPng(iframe: HTMLIFrameElement): Promise<Blob> {
  return new Promise((resolve) => {
    window.addEventListener('message', ({ source, data }: MessageEvent) => {
      const sourceWindow = source as Window | null;
      if (sourceWindow?.location?.href !== window.location.href &&
          (data as ExportResultMessageData)?.action === 'export.result') {
        resolve((data as ExportResultMessageData).data);
      }
    });

    iframe.contentWindow?.postMessage({ action: 'export' }, '*');
  });
}

/**
 * Thrown when the capture promise doesn't settle (neither resolves nor
 * rejects) within TOPNG_CAPTURE_TIMEOUT_MS. Observed on lite-stg
 * page 220659974 / custom content 220659992: `window.createAttachmentInProgress`
 * stayed true for 90+ seconds across four page loads, no `convert_to_png`
 * event ever fired (toPng's own `finally` never ran), and no attachment POST
 * reached the network — the await on toBlob() itself never returned. This
 * class exists only so toPng's catch can tag the timeout with its own
 * telemetry label, distinct from `toPng_failed` (a settled rejection). The
 * cause of that hang IS now established — html-to-image's rAF-gated
 * `createImage`, see model/captureBlob.ts — but the bound stays, so any future
 * never-settling path becomes an observed, retryable failure instead of a
 * silent permanent one.
 */
export class ToPngTimeoutError extends Error {
  constructor() {
    super('toPng: html-to-image toBlob() did not settle within the capture timeout');
    this.name = 'ToPngTimeoutError';
  }
}

// Fresh graph macros on a new page wrote their attachment (full pipeline:
// bootstrap + DOM capture + upload) in ~16s (watched it run on lite-stg,
// 2026-08-19). That figure bounds the WHOLE save, not the toBlob() call in
// isolation — html-to-image's DOM screenshot is a small fraction of it, the
// rest being page bootstrap and the network upload that follows capture. So a
// 10s bound on just the capture step leaves ample margin and shouldn't cut
// off a legitimate slow capture; it only needs to be shorter than "forever".
export const TOPNG_CAPTURE_TIMEOUT_MS = 10_000;

/** Race `promise` against a timeout; on timeout, reject with `makeTimeoutError()`. */
export function withTimeout<T>(promise: Promise<T>, ms: number, makeTimeoutError: () => Error): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(makeTimeoutError()), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

/**
 * Convert diagram to PNG.
 * Uses iframe postMessage if mainFrame exists, otherwise uses html-to-image.
 */
export async function toPng(): Promise<Blob | null | undefined> {
  try {
    /*
    There are 3 options:
    1) Get iframe document.body and generate png in parent frame; problem is: no style
    2) Call "toPng" method on iframe.contentWindow
    3) postMessage to iframe and receive result as message
    */
    const mainFrame = document.getElementById('mainFrame') as HTMLIFrameElement | null;
    if (mainFrame) {
      return await iframeToPng(mainFrame);
    }

    const node = document.getElementsByClassName('screen-capture-content')[0] as HTMLElement;
    // AWAIT so an *async* rejection from html-to-image is caught here. Previously
    // toPng returned the toBlob() promise directly; when html-to-image's internal
    // offscreen image fails to load (it throws a DOM `error` Event — common when
    // rasterizing a remote-server SVG like PlantUML's), that rejection escaped
    // this sync try/catch and surfaced downstream as the opaque `[object Event]`
    // / `non_error_thrown` in attachment_upload_failed (~48% of all failures).
    // Catching it here turns a capture miss into a clean ToPngError skip with
    // its own `convert_to_png` telemetry, not a mislabeled upload failure.
    //
    // Bounded with a timeout: toBlob()'s promise has been observed to never
    // settle at all (see ToPngTimeoutError) — an unbounded await here left
    // `window.createAttachmentInProgress` stuck true, silently blocking every
    // later save for that session. Racing against the timeout guarantees this
    // function always settles.
    //
    // The hang is now explained and fixed: `captureBlob` replaces
    // htmlToImage.toBlob(), whose only resolve path runs inside a
    // requestAnimationFrame callback that Chrome never services in an
    // offscreen (rendering-throttled) Forge macro iframe. See
    // model/captureBlob.ts for the measurement. The timeout stays as a bound
    // on any future never-settling path.
    return await withTimeout(
      captureBlob(node, { backgroundColor: 'white', skipFonts: true }),
      TOPNG_CAPTURE_TIMEOUT_MS,
      () => new ToPngTimeoutError(),
    );
  } catch (e) {
    console.warn('Failed to convert to png', e);
    // Timeout gets its own label so it's countable separately from other
    // convert_to_png capture failures (a settled html-to-image rejection).
    trackEvent(e instanceof ToPngTimeoutError ? 'toPng_timeout' : 'toPng_failed', 'convert_to_png', 'error');
    return undefined;
  } finally {
    trackEvent('toPng', 'convert_to_png', 'export');
  }
}

/**
 * PlantUML renders by fetching an SVG from the remote PlantUML server and
 * inlining it; html-to-image then has to rasterize that inlined remote SVG to
 * make the backup PNG — and fails ~81% of the time (the offscreen image can't
 * decode the server SVG, so html-to-image rejects with a DOM Event). The server
 * already serves a ready raster at /plantuml/png/<encoded>, so fetch THAT
 * directly for the backup and skip html-to-image entirely — see
 * `utils/plantuml/fetchPng.ts`, shared with the interactive Export PNG modal.
 *
 * This wrapper adds the attachment-scoped telemetry and the PDF-export dpi
 * upscale on top of that plain fetch. Returns undefined on any failure so the
 * caller falls back to the DOM capture (the backup is silent, so a degraded
 * capture beats no backup at all).
 */
export async function fetchPlantUmlPng(code: string): Promise<Blob | undefined> {
  try {
    const { fetchPlantUmlPngBlob } = await import('@/utils/plantuml/fetchPng');
    const blob = await fetchPlantUmlPngBlob(code);
    if (!blob) return undefined;
    trackEvent('plantuml_server_png', 'convert_to_png', 'export');
    return (await upscalePlantUmlPng(blob, code)) ?? blob;
  } catch (e) {
    console.warn('PlantUML server PNG fetch failed; falling back to DOM capture', e);
    trackEvent('plantuml_server_png_failed', 'convert_to_png', 'warning');
    return undefined;
  }
}

/**
 * The PlantUML server renders at a fixed 96 dpi by default, so a small
 * diagram (few participants) comes back as a tiny raster (e.g. ~95px wide
 * for a 3-line sequence). The PDF export places every macro image at the
 * fixed content-column width (~6.3in) regardless of the source's native
 * size, so anything under `TARGET_WIDTH_PX` gets stretched ~15x and turns
 * visibly pixelated. Re-request the same diagram at a computed
 * `skinparam dpi` so the natural render is already sharp at that width —
 * see `src/utils/plantuml/resolution.ts` for why `skinparam dpi` (not the
 * `scale` directive, which plantuml.com's public server caps at 4x) is the
 * lever. Best-effort: any failure here just keeps the natural-size PNG
 * already captured by the caller.
 */
export async function upscalePlantUmlPng(naturalBlob: Blob, code: string): Promise<Blob | undefined> {
  const { readPngSize, computeUpscaleDpi, withDpiDirective } = await import('@/utils/plantuml/resolution');
  const size = await readPngSize(naturalBlob);
  if (!size) return undefined;
  const dpi = computeUpscaleDpi(size.width, size.height);
  if (!dpi) return undefined;

  // withDpiDirective only matches a leading `@startuml` — if the caller's
  // content has leading whitespace (validate.ts trims before rejecting, so
  // it's storable) the injection is a no-op and the re-fetch would return
  // the same tiny PNG. Skip it rather than firing a false "upscaled" event.
  const dpiCode = withDpiDirective(code, dpi);
  if (dpiCode === code) return undefined;

  try {
    const { plantumlEncode } = await import('@/utils/plantuml/encode');
    const { PLANTUML_PNG_SERVER } = await import('@/utils/plantuml/fetchPng');
    const encoded = plantumlEncode(dpiCode);
    const resp = await fetch(`${PLANTUML_PNG_SERVER}${encoded}`);
    if (!resp.ok) {
      trackEvent('plantuml_server_png_upscale_failed', 'convert_to_png', 'warning');
      return undefined;
    }
    const blob = await resp.blob();
    const type = (blob.type || '').toLowerCase().split(';')[0].trim();
    if (type !== 'image/png') {
      trackEvent('plantuml_server_png_upscale_failed', 'convert_to_png', 'warning');
      return undefined;
    }
    // Confirm the server actually honoured the dpi directive before trusting
    // it as the "upscaled" result — a rejected/ignored directive would
    // otherwise report success while silently keeping the tiny image.
    const upscaledSize = await readPngSize(blob);
    if (!upscaledSize || upscaledSize.width <= size.width) {
      trackEvent('plantuml_server_png_upscale_failed', 'convert_to_png', 'warning');
      return undefined;
    }
    trackEvent('plantuml_server_png_upscaled', 'convert_to_png', 'export');
    return blob;
  } catch (e) {
    console.warn('PlantUML dpi upscale fetch failed; using natural-size PNG', e);
    trackEvent('plantuml_server_png_upscale_failed', 'convert_to_png', 'warning');
    return undefined;
  }
}

/**
 * Produce the backup PNG for a diagram. PlantUML routes to the deterministic
 * server-side PNG fetch above (html-to-image can't reliably rasterize its
 * remote SVG); every other type captures the rendered DOM via toPng().
 */
// Exported for the byline activation dialog's completion screen (mint a
// deeplink PNG). NOTE: DOM capture is scoped to '.screen-capture-content' /
// '#mainFrame' by bare document lookups, so the diagram preview MUST still be
// mounted in the live DOM when this is called (capture at/just-after save,
// not lazily on the completion screen). Proven for sequence/mermaid/plantuml;
// graph/openapi have no snapshot node and return a non-PNG blob.
export async function capturePng(diagramType?: string, content?: string): Promise<Blob | null | undefined> {
  const trimmed = content?.trim() ?? '';
  if (diagramType === 'plantuml' && trimmed) {
    // Callers can pass a mismatched content/diagramType pair — e.g. the
    // leftover ZenUML `code` field of a doc whose type was later switched to
    // plantuml (stale diagramLoaded emit, or the embed viewer's old fallback
    // chain). Every valid PlantUML body starts with @start... (validate.ts
    // enforces @startuml before render); anything else earns a guaranteed 400
    // from the PlantUML server, so skip straight to the DOM capture.
    if (!trimmed.startsWith('@start')) {
      trackEvent('plantuml_server_png_skipped_content_mismatch', 'convert_to_png', 'warning');
    } else {
      const fetched = await fetchPlantUmlPng(content!);
      if (fetched) return fetched;
      // fall through to the DOM capture if the server fetch failed
    }
  }
  // Never label an old document image with the newest source hash. A skipped
  // save-time capture is repaired by diagramLoaded after the viewer renders.
  const markdownMatches = () => document.querySelector('.screen-capture-content .markdown-document')
    ?.getAttribute('data-markdown-source-hash') === md5(content ?? '');
  if (diagramType === 'markdown' && !markdownMatches()) throw new Error('Markdown preview is still rendering');
  const png = await toPng();
  if (diagramType === 'markdown' && !markdownMatches()) throw new Error('Markdown preview changed during capture');
  return png;
}

/**
 * Convert a Blob to a base64 string (without the `data:` prefix) for shipping
 * the PNG to the backend fallback over the JSON `callRemote` wire. Uses
 * FileReader rather than `blob.arrayBuffer()` for jsdom compatibility in tests.
 */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? '');
      const comma = dataUrl.indexOf(',');
      resolve(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl);
    };
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
    reader.readAsDataURL(blob);
  });
}
