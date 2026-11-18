/**
 * How far one Zoom in / Zoom out toolbar click moves, on every renderer.
 *
 * Was x1.1 for Mermaid and PlantUML (svg-pan-zoom's default sensitivity) and
 * x1.2 for Sequence and Graph. Fullscreen readers pressed Zoom in a median 5
 * times, 38% of them 8 or more (2026-09-14..30, proposal P2); at x1.25 the
 * same distance takes 2 to 4 clicks. One value so the four types feel alike.
 *
 * Toolbar only: the wheel and pinch scale continuously by their own factor
 * (wheelZoom.ts), and do not read this.
 */
export const TOOLBAR_ZOOM_STEP = 1.25;
