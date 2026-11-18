/**
 * P6 measurement: does an author click elements of the editor preview, and
 * what do they do next? (`editor_preview_element_clicked`)
 *
 * Replays show people clicking boxes of the Mermaid preview, maybe expecting
 * to edit a node in place or to find it in the source. Before building "click a
 * node to select its source line" we count how often that happens.
 *
 * One event per editor session at most:
 *   - A press that moved more than DRAG_TOLERANCE_PX is a pan drag (svg-pan-zoom
 *     pans on drag, and a replay records the release as a click), so it never
 *     starts the window. Drags and background clicks before the first element
 *     click are counted.
 *   - The first click on a node, subgraph, edge or label opens a WINDOW_MS
 *     window. The event goes when the window closes, or at once when the editor
 *     closes inside it (`preview_window_completed: false`).
 *
 * Mermaid and PlantUML only: the Sequence preview already edits names in place
 * and Graph is DrawIO. Attached by Workspace.vue on the preview pane, not by the
 * viewport components, so it needs nothing from their internals.
 */
import type { AnalyticsProperties } from '@/utils/analytics/types';

export type PreviewTargetKind = 'node' | 'cluster' | 'edge' | 'label';

/** Same tolerance as DiagramTransformViewport: below it a press is a click. */
export const DRAG_TOLERANCE_PX = 4;
export const WINDOW_MS = 10_000;
const TRACKED_TYPES = new Set(['mermaid', 'plantuml']);

// Mermaid: g.node (flowchart, state, class...), ER entities, sequence actors.
// PlantUML: g.entity / entity_* / elem_* (older SVG output).
const NODE_SELECTOR = [
  'g.node',
  'g[id*="-entity-"]',
  'rect.actor',
  'g.entity',
  'g[id^="entity_"]',
  'g[id^="elem_"]',
].join(',');
const CLUSTER_SELECTOR = 'g.cluster';
const EDGE_SELECTOR = [
  'g.edgeLabel',
  '.edgeLabel',
  'path.flowchart-link',
  'g.edgePaths',
  '.relation',
  'g.link',
  'g[id^="link_"]',
].join(',');

/**
 * What a press on `target` hit: an element kind, 'background' for the svg
 * outside any element, or null when it is not in the diagram at all (toolbar,
 * overlays).
 */
export function classifyPreviewTarget(
  target: Element,
  root: Element,
): PreviewTargetKind | 'background' | null {
  const svg = target.closest('svg') as SVGSVGElement | null;
  if (!svg || !root.contains(svg)) return null;
  if (target.closest(NODE_SELECTOR)) return 'node';
  if (target.closest(EDGE_SELECTOR)) return 'edge';
  if (target.closest(CLUSTER_SELECTOR)) return 'cluster';
  if (target.closest('text, tspan, foreignObject')) return 'label';
  return classifyFlatShape(target, svg);
}

/**
 * The in-browser PlantUML engine draws flat SVG: participant boxes are bare
 * <rect>s beside their <text>, lifelines sit in a <g> with a <title>, messages
 * are <line> + <polygon> arrowheads. Read the shape itself.
 */
function classifyFlatShape(target: Element, svg: SVGSVGElement): PreviewTargetKind | 'background' {
  if (target === svg) return 'background';
  const group = target.closest('g');
  if (group && svg.contains(group) && group.querySelector(':scope > title')) return 'node';
  const tag = target.tagName.toLowerCase();
  if (tag === 'line' || tag === 'polyline' || tag === 'polygon') return 'edge';
  if (tag === 'rect' && coversDiagram(target, svg)) return 'background';
  if (tag === 'rect' || tag === 'ellipse' || tag === 'circle' || tag === 'path') return 'node';
  return 'background';
}

/** A rect at least 90% of the viewBox in both axes is the diagram's backdrop. */
function coversDiagram(rect: Element, svg: SVGSVGElement): boolean {
  const box = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
  const width = Number(rect.getAttribute('width'));
  const height = Number(rect.getAttribute('height'));
  if (box.length !== 4 || !box[2] || !box[3] || !width || !height) return false;
  return width >= box[2] * 0.9 && height >= box[3] * 0.9;
}

export interface PreviewClickTrackerOptions {
  preview: HTMLElement;
  source: HTMLElement | null;
  macroType: () => string;
  codePanelHidden: () => boolean;
  track: (props: Partial<AnalyticsProperties>) => void;
  now?: () => number;
}

export interface PreviewClickTracker {
  /** The source text changed (the editor's code watcher calls this). */
  notifySourceChanged(): void;
  /** Remove listeners; sends the open window, if any, as not completed. */
  dispose(): void;
}

export function createPreviewClickTracker(
  options: PreviewClickTrackerOptions,
): PreviewClickTracker {
  const { preview, source, macroType, codePanelHidden, track } = options;
  const now = options.now ?? Date.now;
  const openedAt = now();

  let sent = false;
  let disposed = false;
  let zoomedIn = false;
  let dragsBefore = 0;
  let backgroundBefore = 0;
  let down: { x: number; y: number; target: Element } | null = null;
  let window: {
    kind: PreviewTargetKind;
    type: string;
    codeHidden: boolean;
    zoomedIn: boolean;
    clicks: number;
    doubleClicks: number;
    sourceFocused: boolean;
    sourceChanged: boolean;
    msSinceOpen: number;
  } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const send = (completed: boolean) => {
    if (!window || sent) return;
    sent = true;
    if (timer) clearTimeout(timer);
    timer = null;
    track({
      macro_type: window.type as AnalyticsProperties['macro_type'],
      preview_target_kind: window.kind,
      preview_zoomed_in_before: window.zoomedIn,
      preview_code_panel_hidden: window.codeHidden,
      preview_drag_count_before: dragsBefore,
      preview_background_click_count_before: backgroundBefore,
      preview_click_count_in_window: window.clicks,
      preview_double_click_count_in_window: window.doubleClicks,
      preview_source_focused_in_window: window.sourceFocused,
      preview_source_changed_in_window: window.sourceChanged,
      preview_window_completed: completed,
      preview_ms_since_editor_open: window.msSinceOpen,
    });
    window = null;
  };

  const onPointerDown = (event: Event) => {
    const e = event as MouseEvent;
    if (e.target instanceof Element) down = { x: e.clientX, y: e.clientY, target: e.target };
  };

  const onPointerUp = (event: Event) => {
    const e = event as MouseEvent;
    const start = down;
    down = null;
    if (!start || sent) return;
    const kind = classifyPreviewTarget(start.target, preview);
    if (kind === null) return;
    const moved =
      Math.abs(e.clientX - start.x) > DRAG_TOLERANCE_PX ||
      Math.abs(e.clientY - start.y) > DRAG_TOLERANCE_PX;
    if (window) {
      if (!moved) window.clicks += 1;
      return;
    }
    if (moved) {
      dragsBefore += 1;
      return;
    }
    if (kind === 'background') {
      backgroundBefore += 1;
      return;
    }
    const type = macroType();
    if (!TRACKED_TYPES.has(type)) return;
    window = {
      kind,
      type,
      codeHidden: codePanelHidden(),
      zoomedIn,
      clicks: 1,
      doubleClicks: 0,
      sourceFocused: false,
      sourceChanged: false,
      msSinceOpen: Math.max(0, now() - openedAt),
    };
    timer = setTimeout(() => send(true), WINDOW_MS);
  };

  const onDoubleClick = () => {
    if (window) window.doubleClicks += 1;
  };

  const onWheel = (event: Event) => {
    const e = event as WheelEvent;
    if ((e.ctrlKey || e.metaKey) && e.deltaY < 0) zoomedIn = true;
  };

  // The editor's zoom buttons may sit in the header, outside the preview pane.
  const onDocumentClick = (event: Event) => {
    const target = event.target;
    if (target instanceof Element && target.closest('button[aria-label="Zoom in"]')) {
      zoomedIn = true;
    }
  };

  const onSourceFocus = () => {
    if (window) window.sourceFocused = true;
  };

  preview.addEventListener('pointerdown', onPointerDown, true);
  preview.addEventListener('pointerup', onPointerUp, true);
  preview.addEventListener('dblclick', onDoubleClick, true);
  preview.addEventListener('wheel', onWheel, { capture: true, passive: true });
  document.addEventListener('click', onDocumentClick, true);
  source?.addEventListener('focusin', onSourceFocus);

  return {
    notifySourceChanged() {
      if (window) window.sourceChanged = true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      send(false);
      if (timer) clearTimeout(timer);
      preview.removeEventListener('pointerdown', onPointerDown, true);
      preview.removeEventListener('pointerup', onPointerUp, true);
      preview.removeEventListener('dblclick', onDoubleClick, true);
      preview.removeEventListener('wheel', onWheel, true);
      document.removeEventListener('click', onDocumentClick, true);
      source?.removeEventListener('focusin', onSourceFocus);
    },
  };
}
