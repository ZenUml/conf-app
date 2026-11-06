type SvgSize = Pick<DOMRect, 'width' | 'height'>;

/** svg-pan-zoom cannot initialize while the SVG's screen matrix is singular. */
export function hasSvgLayout({ width, height }: SvgSize): boolean {
  return width > 0 && height > 0;
}
