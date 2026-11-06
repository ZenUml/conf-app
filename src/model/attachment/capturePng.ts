import { captureBlob } from '@/model/captureBlob';
import { captureMacroType, captureStageOf, describeCaptureError } from '@/model/captureFailure';
import md5 from 'md5';
import { trackEvent } from '@/utils/window';
import type { Surface } from '@/utils/analytics/catalog';

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
export async function toPng(diagramType?: string): Promise<Blob | null | undefined> {
  // Declared outside the try so the catch can report its size (#1061).
  let node: HTMLElement | undefined;
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

    node = document.getElementsByClassName('screen-capture-content')[0] as HTMLElement;
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
    // `error` category: never down-sampled (utils/window.ts), so every failure
    // carries its reason (#1061). Fields are bounded and hold no diagram text.
    const timedOut = e instanceof ToPngTimeoutError;
    trackEvent(timedOut ? 'toPng_timeout' : 'toPng_failed', 'convert_to_png', 'error', {
      capture_failure_stage: captureStageOf(e),
      capture_error: describeCaptureError(e),
      macro_type: captureMacroType(diagramType),
      ...(node ? { capture_node_width: node.clientWidth, capture_node_height: node.clientHeight } : {}),
      document_visibility: document.visibilityState,
    });
    return undefined;
  } finally {
    trackEvent('toPng', 'convert_to_png', 'export');
  }
}

/**
 * The PlantUML backup PNG, without html-to-image (`utils/plantuml/png.ts`).
 * With the local renderer (ADR-0010) the engine's SVG is drawn on a canvas and
 * nothing leaves the browser; otherwise the PlantUML server's raster is
 * fetched, as before — html-to-image could not rasterise that remote SVG
 * (~81% failure, a DOM Event rejection). Either way a small diagram is raised
 * toward `TARGET_WIDTH_PX` so the PDF export, which stretches every image to
 * the column width, stays sharp.
 *
 * Returns undefined on any failure so the caller falls back to the DOM capture
 * (the backup is silent, so a degraded capture beats no backup at all).
 */
export async function fetchPlantUmlPng(code: string, surface: Surface): Promise<Blob | undefined> {
  try {
    const { producePlantUmlPng } = await import('@/utils/plantuml/png');
    const result = await producePlantUmlPng(code, { purpose: 'backup', surface, upscale: true, background: 'white' });
    // The legacy convert_to_png labels count server rasters only, as before.
    const fromServer = result.source !== 'local';
    if (!result.ok) {
      if (fromServer) trackEvent('plantuml_server_png_failed', 'convert_to_png', 'warning');
      return undefined;
    }
    if (fromServer) {
      trackEvent('plantuml_server_png', 'convert_to_png', 'export');
      if (result.upscale === 'done') trackEvent('plantuml_server_png_upscaled', 'convert_to_png', 'export');
      if (result.upscale === 'failed') trackEvent('plantuml_server_png_upscale_failed', 'convert_to_png', 'warning');
    }
    return result.blob;
  } catch (e) {
    console.warn('PlantUML PNG failed; falling back to DOM capture', e);
    trackEvent('plantuml_server_png_failed', 'convert_to_png', 'warning');
    return undefined;
  }
}

/**
 * Produce the backup PNG for a diagram. PlantUML routes to the deterministic
 * raster above (local engine SVG, or the server's PNG); every other type
 * captures the rendered DOM via toPng().
 */
// Exported for the byline activation dialog's completion screen (mint a
// deeplink PNG). NOTE: DOM capture is scoped to '.screen-capture-content' /
// '#mainFrame' by bare document lookups, so the diagram preview MUST still be
// mounted in the live DOM when this is called (capture at/just-after save,
// not lazily on the completion screen). Proven for sequence/mermaid/plantuml;
// graph/openapi have no snapshot node and return a non-PNG blob.
export async function capturePng(
  diagramType?: string,
  content?: string,
  surface: Surface = 'viewer',
): Promise<Blob | null | undefined> {
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
      const fetched = await fetchPlantUmlPng(content!, surface);
      if (fetched) return fetched;
      // fall through to the DOM capture if no raster came back
    }
  }
  // Never label an old document image with the newest source hash. A skipped
  // save-time capture is repaired by diagramLoaded after the viewer renders.
  const markdownMatches = () => document.querySelector('.screen-capture-content .markdown-document')
    ?.getAttribute('data-markdown-source-hash') === md5(content ?? '');
  if (diagramType === 'markdown' && !markdownMatches()) throw new Error('Markdown preview is still rendering');
  const png = await toPng(diagramType);
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
