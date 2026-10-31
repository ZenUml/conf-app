/**
 * One PlantUML PNG raster for the backup attachment and Export PNG (ADR-0010
 * step 6), drawn by the same engine the viewer uses.
 *
 * WHY. With the local renderer on, the macro draws without plantuml.com, but
 * the PNG paths still fetched `/plantuml/png/<encoded>`, so the source left the
 * browser on every backup attempt. For a viewer who cannot save the backup
 * (anonymous, guest) that repeated on every page load.
 *
 *  - `local`: rasterise the engine's SVG on a canvas. The server is never
 *    asked for this diagram, not even when the raster fails: the viewer drew
 *    it locally, and a PNG is not worth sending the source for.
 *  - `server`, or a diagram the engine cannot draw (`server_fallback`, the same
 *    rule `PlantUml.vue` applies): fetch the server's raster as before.
 *
 * The old reason for fetching a server raster at all, "html-to-image cannot
 * decode the server SVG" (`fetchPng.ts`), does not reach this path: the local
 * SVG goes straight into an <img> from a data URL, with no DOM clone or style
 * inlining, and it has no external references to load.
 *
 * Never throws: every outcome is a result the caller can report.
 */
import type { PlantUmlPngFailure, PlantUmlPngPurpose, PlantUmlRenderer, Surface } from '@/utils/analytics/catalog';
import type { AnalyticsProperties } from '@/utils/analytics/types';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';
import { plantUmlRenderer } from './renderer';
import { fetchPlantUmlPngBlob } from './fetchPng';
import { readPlantUmlSvgSize } from './normalizeSvg';
import { BASE_DPI, computeUpscaleDpi, computeUpscaleFactor, readPngSize, withDpiDirective } from './resolution';

export interface PlantUmlPngOptions {
  purpose: PlantUmlPngPurpose;
  /** Where the request came from, for the analytics event. */
  surface: Surface;
  /** Raise a small diagram toward `TARGET_WIDTH_PX`, for the PDF column (the backup). */
  upscale?: boolean;
  /** Painted behind the drawing; the raster is transparent when omitted. */
  background?: string;
  /**
   * Pixels per diagram pixel when `upscale` is off: 2 for Export PNG and its
   * preview, so a small diagram stays sharp when the dialog fits it to the
   * canvas or the user zooms the download. The server path asks for the same
   * density with `skinparam dpi` (96 × ratio) in its one request.
   */
  pixelRatio?: number;
}

/** `upscale`: `none` = not asked or not needed; `failed` = the natural size was kept. */
export type PlantUmlPngResult =
  | { ok: true; blob: Blob; source: PlantUmlRenderer; upscale: 'none' | 'done' | 'failed' }
  | { ok: false; source: PlantUmlRenderer; failure: PlantUmlPngFailure };

// Chrome's per-side canvas limit; captureBlob.ts clamps to the same value.
const CANVAS_DIMENSION_LIMIT = 16384;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // decode() is best-effort, as in captureBlob.ts: a rejection must not hang
    // or fail a raster the browser can still draw.
    img.onload = () => {
      if (typeof img.decode === 'function') img.decode().then(() => resolve(img), () => resolve(img));
      else resolve(img);
    };
    img.onerror = () => reject(new Error('PlantUML SVG failed to load as an image'));
    img.src = url;
  });
}

/**
 * Give the SVG root an explicit pixel size so the browser rasterises the
 * vector at the target resolution instead of stretching a 1x bitmap. The
 * viewBox keeps the coordinate system; one is added from the natural size if
 * the engine left it out.
 */
function sizedSvg(svg: string, natural: { width: number; height: number }, width: number, height: number): string {
  return svg.replace(/<svg\b[^>]*>/i, (tag) => {
    let next = tag
      .replace(/\s(width|height|preserveAspectRatio)="[^"]*"/gi, '')
      .replace(/\sstyle="([^"]*)"/i, (_m, style: string) => {
        const kept = style.split(';').map((d) => d.trim()).filter((d) => d && !/^(width|height)\s*:/i.test(d));
        return kept.length ? ` style="${kept.join(';')};"` : '';
      });
    if (!/\sviewBox="/i.test(next)) next = next.replace(/^<svg\b/i, `<svg viewBox="0 0 ${natural.width} ${natural.height}"`);
    return next.replace(/^<svg\b/i, `<svg width="${width}" height="${height}"`);
  });
}

/**
 * Draw a PlantUML SVG on a canvas and encode it as PNG. `scale` multiplies
 * the SVG's own pixel size. Resolves undefined when it cannot.
 */
export async function rasterisePlantUmlSvg(
  svg: string,
  { scale = 1, background }: { scale?: number; background?: string } = {},
): Promise<Blob | undefined> {
  const natural = readPlantUmlSvgSize(svg);
  if (!natural) return undefined;
  const fit = Math.min(scale, CANVAS_DIMENSION_LIMIT / natural.width, CANVAS_DIMENSION_LIMIT / natural.height);
  const width = Math.max(1, Math.round(natural.width * fit));
  const height = Math.max(1, Math.round(natural.height * fit));

  const markup = sizedSvg(svg, natural, width, height);
  const img = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.drawImage(img, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  return blob ?? undefined;
}

async function localPng(svg: string, options: PlantUmlPngOptions): Promise<PlantUmlPngResult> {
  const source: PlantUmlRenderer = 'local';
  try {
    const natural = readPlantUmlSvgSize(svg);
    const scale = options.upscale && natural ? computeUpscaleFactor(natural.width, natural.height) : null;
    const blob = await rasterisePlantUmlSvg(svg, { scale: scale ?? options.pixelRatio ?? 1, background: options.background });
    if (!blob) return { ok: false, source, failure: 'raster_failed' };
    return { ok: true, blob, source, upscale: scale ? 'done' : 'none' };
  } catch (e) {
    console.warn('PlantUML local SVG could not be rasterised', e);
    return { ok: false, source, failure: 'raster_failed' };
  }
}

/**
 * The server renders at a fixed 96 dpi; re-request a small diagram at the
 * `skinparam dpi` that reaches the PDF column width (see resolution.ts for why
 * dpi and not `scale`). Undefined when not needed; `false` when it failed.
 */
async function upscaleServerPng(natural: Blob, code: string): Promise<Blob | undefined | false> {
  const size = await readPngSize(natural);
  const dpi = size && computeUpscaleDpi(size.width, size.height);
  if (!size || !dpi) return undefined;
  // withDpiDirective only matches a leading `@startuml`; with leading
  // whitespace the injection is a no-op and the re-fetch would return the same
  // tiny PNG. Skip it rather than report a false upscale.
  const dpiCode = withDpiDirective(code, dpi);
  if (dpiCode === code) return undefined;
  try {
    const blob = await fetchPlantUmlPngBlob(dpiCode);
    // Confirm the server honoured the directive before trusting the result.
    const upscaled = blob && (await readPngSize(blob));
    return upscaled && upscaled.width > size.width ? blob : false;
  } catch (e) {
    console.warn('PlantUML dpi upscale fetch failed; using natural-size PNG', e);
    return false;
  }
}

/**
 * One request at `pixelRatio` × the server's 96 dpi. Undefined when no denser
 * raster applies or the server did not give one; the caller then fetches the
 * natural size as before.
 */
async function denseServerPng(code: string, pixelRatio: number): Promise<Blob | undefined> {
  const dpiCode = withDpiDirective(code, Math.round(BASE_DPI * pixelRatio));
  if (dpiCode === code) return undefined;
  try {
    return await fetchPlantUmlPngBlob(dpiCode);
  } catch (e) {
    console.warn('PlantUML dense PNG fetch failed; fetching the natural size', e);
    return undefined;
  }
}

async function serverPng(code: string, source: PlantUmlRenderer, options: PlantUmlPngOptions): Promise<PlantUmlPngResult> {
  if (!options.upscale && (options.pixelRatio ?? 1) > 1) {
    const dense = await denseServerPng(code, options.pixelRatio!);
    if (dense) return { ok: true, blob: dense, source, upscale: 'none' };
  }
  let blob: Blob | undefined;
  try {
    blob = await fetchPlantUmlPngBlob(code);
  } catch (e) {
    console.warn('PlantUML server PNG fetch failed', e);
    return { ok: false, source, failure: 'server_fetch_failed' };
  }
  if (!blob) return { ok: false, source, failure: 'server_no_png' };
  if (!options.upscale) return { ok: true, blob, source, upscale: 'none' };
  const upscaled = await upscaleServerPng(blob, code);
  if (upscaled === undefined) return { ok: true, blob, source, upscale: 'none' };
  if (upscaled === false) return { ok: true, blob, source, upscale: 'failed' };
  return { ok: true, blob: upscaled, source, upscale: 'done' };
}

/** The engine's SVG, or the reason it cannot draw this diagram (then the server does). */
async function localSvg(code: string): Promise<{ svg: string } | { fallbackReason: AnalyticsProperties['plantuml_failure_reason'] }> {
  try {
    const { renderPlantUmlLocally } = await import('./engine');
    return { svg: await renderPlantUmlLocally(code) };
  } catch (err) {
    const reason = (err as { reason?: AnalyticsProperties['plantuml_failure_reason'] })?.reason;
    return { fallbackReason: reason ?? 'load_failed' };
  }
}

export async function producePlantUmlPng(code: string, options: PlantUmlPngOptions): Promise<PlantUmlPngResult> {
  let result: PlantUmlPngResult;
  let fallbackReason: AnalyticsProperties['plantuml_failure_reason'];
  if ((await plantUmlRenderer()) === 'local') {
    const local = await localSvg(code);
    if ('svg' in local) {
      result = await localPng(local.svg, options);
    } else {
      fallbackReason = local.fallbackReason;
      result = await serverPng(code, 'server_fallback', options);
    }
  } else {
    result = await serverPng(code, 'server', options);
  }

  const props: AnalyticsProperties = {
    feature_area: 'macro',
    surface: options.surface,
    macro_type: 'plantuml',
    plantuml_png_source: result.source,
    plantuml_png_purpose: options.purpose,
    ...(fallbackReason ? { plantuml_failure_reason: fallbackReason } : {}),
  };
  if (result.ok) {
    trackAnalyticsEvent('plantuml_png_produced', {
      ...props,
      ...(options.upscale ? { plantuml_png_upscaled: result.upscale === 'done' } : {}),
    });
  } else {
    trackAnalyticsEvent('plantuml_png_failed', { ...props, plantuml_png_failure: result.failure });
  }
  return result;
}

