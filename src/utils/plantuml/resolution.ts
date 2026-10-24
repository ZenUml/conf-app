/**
 * Helpers for boosting the resolution of the PlantUML server's raster PNG
 * (see `fetchPlantUmlPng` in `src/model/Attachment.ts`).
 *
 * Root cause (confirmed empirically 2026-08-19, see docs/debugging — the
 * public plantuml.com server renders at a fixed 96 dpi by default, so a
 * small diagram (few participants) produces a tiny raster: e.g. a
 * three-line sequence diagram comes back ~95-120px wide. The PDF export
 * places every macro image at the fixed content-column width (~6.3in ≈
 * 1400px at typical export scale) regardless of the source image's native
 * size, so anything under that width gets upscaled ~15x and turns visibly
 * pixelated.
 *
 * The `scale N` / `scale N width` PlantUML directives were tried first and
 * ruled out: plantuml.com's public server caps them at 4x magnification
 * regardless of the requested value (verified: `scale 1400`, `scale 8`,
 * `scale 16` on a 118px-wide diagram all returned the same 474px-wide
 * image as `scale 4`). `skinparam dpi <n>` has no such cap — it scales the
 * output linearly with no observed ceiling (dpi 1200 on that same 118px
 * diagram returned 1484px wide, dpi 2400 returned 2968px wide) — so it is
 * the lever used here.
 */

import { blobToArrayBuffer } from '@/utils/blobToArrayBuffer';
import { readPngSize as readPngSizeFromBytes } from '@/lib/png.js';

const BASE_DPI = 96;

/** Target width (px) a diagram that fills the macro column should reach. */
export const TARGET_WIDTH_PX = 1400;

/**
 * Upper bound (px) on either output dimension. Guards against a
 * pathologically narrow-but-tall (or wide-but-short) diagram driving the
 * computed dpi so high the other dimension balloons past what's useful for
 * an export image (file size, memory, PlantUML server limits).
 */
export const MAX_DIMENSION_PX = 4000;

/**
 * Compute the `skinparam dpi` value needed to bring a PlantUML PNG's width
 * up to `TARGET_WIDTH_PX`, capping either dimension at `MAX_DIMENSION_PX`.
 * Returns null when no upscale is needed (already at/above target) or
 * possible (zero-sized input).
 */
export function computeUpscaleDpi(naturalWidth: number, naturalHeight: number): number | null {
  if (!naturalWidth || naturalWidth <= 0 || naturalWidth >= TARGET_WIDTH_PX) return null;

  let scale = TARGET_WIDTH_PX / naturalWidth;
  scale = Math.min(scale, MAX_DIMENSION_PX / naturalWidth);
  if (naturalHeight > 0) {
    scale = Math.min(scale, MAX_DIMENSION_PX / naturalHeight);
  }
  if (scale <= 1) return null;

  return Math.round(BASE_DPI * scale);
}

/**
 * Insert a `skinparam dpi <n>` directive right after the `@startuml` line.
 * If the source doesn't start with `@startuml`, it's returned unchanged —
 * callers already gate on that prefix (see `capturePng` in Attachment.ts).
 */
export function withDpiDirective(source: string, dpi: number): string {
  return source.replace(/^(@startuml[^\n]*\n)/, `$1skinparam dpi ${dpi}\n`);
}

/**
 * Read the width/height from a PNG's IHDR chunk without decoding the image.
 * Returns null for anything that isn't a well-formed PNG header.
 */
export async function readPngSize(blob: Blob): Promise<{ width: number; height: number } | null> {
  return readPngSizeFromBytes(new Uint8Array(await blobToArrayBuffer(blob)));
}
