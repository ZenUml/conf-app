// Frames a captured diagram PNG into a Slack-ready deeplink card image.
//
// WHY: the embed-deeplink preview card uses `twitter:card=summary_large_image`,
// which Slack renders at a fixed ~1.91:1 and CENTER-CROPS whatever it's given.
// Customer diagrams are every shape:
//   - A tall sequence diagram (the most common shape) sent raw loses ~70% to
//     the crop — a meaningless middle slice.
//   - Simply padding a tall diagram onto a 1.91:1 canvas shrinks it to a thin,
//     unreadable strip.
// So framing is SHAPE-AWARE (design demo: the deeplink-card-framing artifact):
//   - wide / moderate (aspect >= TALL_THRESHOLD): CONTAIN — the whole diagram,
//     letterboxed on white, nothing cut, aspect preserved.
//   - tall (aspect < TALL_THRESHOLD): TOP-ANCHOR — scale to the card width and
//     anchor at the top so the participants + opening calls stay readable; the
//     tail overflows the bottom and is cropped. The card is a TEASER — "Open in
//     Confluence" carries the rest.
//
// This is the capture-side framing the Share UI (byline §6) runs after
// html-to-image, before POSTing pngBase64 to functions/deeplink-ticket.ts. The
// mint and the /i Worker never reshape the image — they are byte-passthrough.

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 628; // 1200 / 628 = 1.911 ≈ Slack's summary_large_image 1.91:1
/** Below this source aspect (w/h), CONTAIN would produce an unreadable strip, so we TOP-ANCHOR instead. */
export const TALL_THRESHOLD = 0.8;
/** White margin (px, in card space) so a contained diagram never touches the card edge. */
export const CONTAIN_PADDING = 24;

export type CardMode = 'contain' | 'top-anchor';

export interface CardLayout {
  mode: CardMode;
  /** Output canvas size (always the card ratio). */
  targetW: number;
  targetH: number;
  /** Where to draw the source image on the output canvas. Source aspect is always preserved. */
  drawX: number;
  drawY: number;
  drawW: number;
  drawH: number;
}

export interface CardLayoutOptions {
  targetW?: number;
  targetH?: number;
  tallThreshold?: number;
  pad?: number;
}

/**
 * Pure geometry: given a source diagram's pixel size, decide how to place it on
 * a card-ratio canvas. No canvas/DOM — this is the testable heart of the design.
 */
export function computeCardLayout(srcW: number, srcH: number, opts: CardLayoutOptions = {}): CardLayout {
  const targetW = opts.targetW ?? CARD_WIDTH;
  const targetH = opts.targetH ?? CARD_HEIGHT;
  const tallThreshold = opts.tallThreshold ?? TALL_THRESHOLD;
  const pad = opts.pad ?? CONTAIN_PADDING;

  if (!(srcW > 0) || !(srcH > 0)) {
    throw new Error(`computeCardLayout: source dimensions must be positive (got ${srcW}x${srcH})`);
  }

  const aspect = srcW / srcH;

  if (aspect < tallThreshold) {
    // TALL → top-anchor: fill the card width, anchor at the top, let the bottom
    // overflow (cropped). Keeps the identifying part (participants + opening) big.
    const scale = targetW / srcW;
    return {
      mode: 'top-anchor',
      targetW,
      targetH,
      drawX: 0,
      drawY: 0,
      drawW: targetW,
      drawH: srcH * scale, // > targetH; the excess below the card edge is cropped
    };
  }

  // WIDE / MODERATE → contain: fit the whole diagram inside a padded box, centered.
  const boxW = targetW - pad * 2;
  const boxH = targetH - pad * 2;
  const scale = Math.min(boxW / srcW, boxH / srcH);
  const drawW = srcW * scale;
  const drawH = srcH * scale;
  return {
    mode: 'contain',
    targetW,
    targetH,
    drawX: (targetW - drawW) / 2,
    drawY: (targetH - drawH) / 2,
    drawW,
    drawH,
  };
}

export interface FramedCard {
  blob: Blob;
  width: number;
  height: number;
  mode: CardMode;
}

/**
 * Browser-only: draw `source` (an <img>, <canvas>, or ImageBitmap from
 * html-to-image) onto a white card-ratio canvas per computeCardLayout, and
 * return a PNG blob ready to base64 + POST to the mint. `srcW`/`srcH` are the
 * source's intrinsic pixel size.
 */
export async function frameDiagramForCard(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  opts: CardLayoutOptions = {},
): Promise<FramedCard> {
  const layout = computeCardLayout(srcW, srcH, opts);
  const canvas = document.createElement('canvas');
  canvas.width = layout.targetW;
  canvas.height = layout.targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('frameDiagramForCard: 2D canvas context unavailable');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, layout.targetW, layout.targetH);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, layout.drawX, layout.drawY, layout.drawW, layout.drawH);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('frameDiagramForCard: canvas.toBlob returned null');
  return { blob, width: layout.targetW, height: layout.targetH, mode: layout.mode };
}
