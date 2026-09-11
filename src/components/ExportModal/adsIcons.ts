// Icons for the export toolbar.
//
// The nine toolbar glyphs are lifted VERBATIM from the Figma frame
// "03 - Icons revised per DESIGN.md" (ZenUML · Export canvas · Shottr layout).
// Their `d` strings are byte-identical to that file's SVG export, so each one
// keeps the frame's own coordinate space; `viewBox` is a 16x16 window centred
// on the glyph's bounding box in that space, and `strokeWidth` is the source's
// (1). Nothing here is redrawn or re-fitted by hand — re-export the frame and
// paste over the `d` when the design changes.
//
// The six remaining glyphs have no counterpart in that frame; they are the
// official heroicons@2 24x24 outline paths, likewise verbatim.
export type AdsIconGlyph = {
  /** Coordinate window for `d`, in the source file's own units. */
  viewBox: string;
  /** Path data, copied verbatim from the source. */
  d: string;
  /** Stroke width in that same coordinate space. */
  strokeWidth: number;
};

const figma = (viewBox: string, d: string): AdsIconGlyph => ({ viewBox, d, strokeWidth: 1 });
const heroicon = (d: string): AdsIconGlyph => ({ viewBox: '0 0 24 24', d, strokeWidth: 1.5 });

export const ADS_ICONS = {
  /** Figma toolbar — draw arrow. */
  arrow: figma('382 100 16 16', 'M385 113L395 103M395 110.5V103H387.5'),
  /** Figma toolbar — add text (I-beam). */
  text: figma('338 100 16 16', 'M341 104V102.5H351V104M346 102.5V113.5M344 113.5H348'),
  /** Figma toolbar — add callout. */
  comment: figma(
    '428 100 16 16',
    'M433 105.5H439M433 107.5H436M429.5 108.505C429.5 109.573 430.25 110.505 431.302 110.656C432.057 110.771 432.818 110.854 433.589 110.911C433.818 110.927 434.031 111.052 434.161 111.245L436 114L437.839 111.245C437.969 111.052 438.182 110.927 438.411 110.911C439.177 110.854 439.937 110.771 440.698 110.656C441.75 110.505 442.5 109.573 442.5 108.505V104.495C442.5 103.427 441.75 102.495 440.698 102.344C439.141 102.115 437.573 102 436 102C434.406 102 432.839 102.115 431.302 102.344C430.25 102.495 429.5 103.427 429.5 104.495V108.505Z',
  ),
  /** heroicons LockClosedIcon — retained for callers that need a lock. */
  lock: heroicon(
    'M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z',
  ),
  /** heroicons ArrowPathIcon — refresh preview. */
  refresh: heroicon(
    'M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99',
  ),
  /** Figma toolbar — close export. */
  cross: figma('80 100 16 16', 'M84 112L92 104M84 104L92 112'),
  /** Figma toolbar — download image. */
  download: figma(
    '162 100 16 16',
    'M164 111V112.5C164 113.328 164.672 114 165.5 114H174.5C175.328 114 176 113.328 176 112.5V111M167 108L170 111L173 108M170 111V102',
  ),
  /** Figma toolbar — copy image. */
  copy: figma(
    '126 100 16 16',
    'M136.5 111.5V113.75C136.5 114.161 136.161 114.5 135.75 114.5H129.25C128.833 114.5 128.5 114.167 128.5 113.75V105.25C128.5 104.839 128.839 104.5 129.25 104.5H130.5C130.833 104.5 131.172 104.526 131.5 104.583M136.5 111.5H138.75C139.161 111.5 139.5 111.161 139.5 110.75V107.5C139.5 104.526 137.339 102.057 134.5 101.583C134.172 101.526 133.833 101.5 133.5 101.5H132.25C131.839 101.5 131.5 101.839 131.5 102.25V104.583M136.5 111.5H132.25C131.833 111.5 131.5 111.167 131.5 110.75V104.583M139.5 109V107.75C139.5 106.505 138.495 105.5 137.25 105.5H136.25C135.833 105.5 135.5 105.167 135.5 104.75V103.75C135.5 102.505 134.495 101.5 133.25 101.5H132.5',
  ),
  /** heroicons TrashIcon — remove. */
  trash: heroicon(
    'm14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0',
  ),
  /** heroicons PlusIcon — add. */
  add: heroicon('M12 4.5v15m7.5-7.5h-15'),
  /** heroicons InformationCircleIcon — information. */
  info: heroicon(
    'm11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z',
  ),
  /** heroicons CheckIcon — success. */
  check: heroicon('m4.5 12.75 6 6 9-13.5'),
  /** Figma toolbar — select annotations (pointer). */
  select: figma(
    '294 100 16 16',
    'M297.333 102V112.667L300.333 110L302.667 114.667L304.667 113.667L302.333 109H306.667L297.333 102Z',
  ),
  /** Figma toolbar — draw rectangle. */
  rectangle: figma(
    '472 100 16 16',
    'M475.5 105C475.5 104.172 476.172 103.5 477 103.5H483C483.828 103.5 484.5 104.172 484.5 105V111C484.5 111.828 483.828 112.5 483 112.5H477C476.172 112.5 475.5 111.828 475.5 111V105Z',
  ),
  /** Figma toolbar — add watermark (stamp). */
  stamp: figma(
    '516 100 16 16',
    'M518.667 114.667H529.333M521.333 110V108.667C521.333 107.333 522.667 107.333 522.667 106V104.667C522.365 104.397 522.152 104.041 522.056 103.648C521.961 103.254 521.987 102.841 522.132 102.462C522.276 102.084 522.532 101.758 522.866 101.529C523.199 101.299 523.595 101.176 524 101.176C524.405 101.176 524.801 101.299 525.134 101.529C525.468 101.758 525.724 102.084 525.868 102.462C526.013 102.841 526.039 103.254 525.944 103.648C525.848 104.041 525.635 104.397 525.333 104.667V106C525.333 107.333 526.667 107.333 526.667 108.667V110M519.333 110H528.667L530 112.667H518L519.333 110Z',
  ),
} as const satisfies Record<string, AdsIconGlyph>;

export type AdsIconName = keyof typeof ADS_ICONS;
