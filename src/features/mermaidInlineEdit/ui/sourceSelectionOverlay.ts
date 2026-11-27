import type { AnalyticsProperties } from '@/utils/analytics/types';
import type { SourceMap } from '../types';
import { baseProps, unionRect, type InlineEditAdapter } from './adapter';
import { elementsOf } from './domMapping';
import { isTypingInSourceLabel, matchSourceLabel, type SourceLabel } from './sourceSelection';
import { MERMAID_SOURCE_SELECTION, type MermaidSourceSelection, type MermaidSourceRange } from './surface';

interface SourceSelectionOverlayDeps {
  svg: () => Element | null;
  viewport: () => HTMLElement | undefined;
  getCode: () => string;
  mappedSvg: (code: string, root: Element) => { map: SourceMap; adapter: InlineEditAdapter } | null;
  isBlocked: () => boolean;
  hideHover: () => void;
  trackShown: (props: AnalyticsProperties) => void;
}

/** Source-only visual affordance. The existing inline editor handles all edits. */
export function attachSourceSelectionOverlay(container: HTMLElement, deps: SourceSelectionOverlayDeps) {
  const doc = container.ownerDocument;
  const win = doc.defaultView ?? window;
  let sourceSelection: MermaidSourceRange | null = null;
  let approvedSource: { code: string; label: SourceLabel; root: Element; elements: Element[]; props: AnalyticsProperties } | null = null;
  let sourceRing: HTMLDivElement | null = null;
  let sourceHint: HTMLDivElement | null = null;
  let sourceObserver: MutationObserver | null = null;
  let sourceResizeObserver: ResizeObserver | null = null;
  let sourceHintReported = false;

  function hideSourceRing(): void {
    sourceObserver?.disconnect();
    sourceObserver = null;
    sourceResizeObserver?.disconnect();
    sourceResizeObserver = null;
    sourceHint?.remove();
    sourceHint = null;
    sourceRing?.remove();
    sourceRing = null;
  }

  function clearSourceSelection(): void {
    hideSourceRing();
    sourceSelection = null;
    approvedSource = null;
  }

  function placeSourceRing(): void {
    const selected = approvedSource;
    const vp = deps.viewport();
    if (!selected || !vp || !sourceRing || !selected.root.isConnected) return hideSourceRing();
    const bounds = vp.getBoundingClientRect();
    const { left, top, right, bottom } = unionRect(selected.elements);
    Object.assign(sourceRing.style, {
      left: `${left - bounds.left}px`, top: `${top - bounds.top}px`,
      width: `${right - left}px`, height: `${bottom - top}px`,
    });
    if (!sourceHint) return;
    const visible = right > left && bottom > top
      && right > bounds.left && left < bounds.right && bottom > bounds.top && top < bounds.bottom;
    sourceHint.hidden = !visible;
    if (!visible) return;
    const half = sourceHint.offsetWidth / 2;
    const center = (left + right) / 2 - bounds.left;
    sourceHint.style.left = `${Math.max(half + 4, Math.min(bounds.width - half - 4, center))}px`;
    const below = bottom - bounds.top + 5;
    sourceHint.style.top = `${below + sourceHint.offsetHeight <= bounds.height
      ? below : Math.max(0, top - bounds.top - sourceHint.offsetHeight - 5)}px`;
    if (!sourceHintReported) {
      sourceHintReported = true;
      deps.trackShown(selected.props);
    }
  }

  function showSourceRing(root: Element, showHint: boolean): void {
    const vp = deps.viewport();
    if (!vp) return hideSourceRing();
    if (!sourceRing) {
      deps.hideHover();
      sourceRing = doc.createElement('div');
      sourceRing.className = 'mie-source-ring';
      sourceRing.dataset.testid = 'mermaid-source-selection-ring';
      vp.appendChild(sourceRing);
      sourceObserver = new MutationObserver(placeSourceRing);
      sourceObserver.observe(root, { attributes: true, subtree: true, attributeFilter: ['transform', 'style'] });
      if (root.parentElement) sourceObserver.observe(root.parentElement, { childList: true });
      if (typeof ResizeObserver !== 'undefined') {
        sourceResizeObserver = new ResizeObserver(placeSourceRing);
        sourceResizeObserver.observe(vp);
      }
    }
    if (!showHint) {
      sourceHint?.remove();
      sourceHint = null;
    } else if (!sourceHint) {
      sourceHint = doc.createElement('div');
      sourceHint.className = 'mie-source-hint';
      sourceHint.dataset.testid = 'mermaid-source-selection-hint';
      sourceHint.setAttribute('role', 'status');
      sourceHint.textContent = 'You can also double-click here to edit.';
      vp.appendChild(sourceHint);
    }
    placeSourceRing();
  }

  function updateSourceSelection(): void {
    const selection = sourceSelection;
    const root = deps.svg();
    if (!selection || !root || deps.isBlocked()) return hideSourceRing();
    const mapped = deps.mappedSvg(selection.code, root);
    if (!mapped) {
      if (approvedSource?.root === root && selection.code === deps.getCode()
        && isTypingInSourceLabel(approvedSource.code, approvedSource.label.range, selection)) {
        showSourceRing(root, false);
      } else {
        if (!selection.typing) approvedSource = null;
        hideSourceRing();
      }
      return;
    }
    const { map, adapter: mapAdapter } = mapped;
    const label = matchSourceLabel(map, selection);
    if (!label) {
      approvedSource = null;
      return hideSourceRing();
    }
    const showHint = !selection.typing && selection.from !== selection.to;
    // Arrow movement inside one label reuses its already verified rendered elements.
    if (approvedSource?.root === root && approvedSource.code === selection.code
      && approvedSource.label.kind === label.kind && approvedSource.label.key === label.key) {
      approvedSource.label = label;
      if (!sourceRing || !!sourceHint !== showHint) showSourceRing(root, showHint);
      return;
    }
    const exact = (selector: string, predicate: (el: Element) => boolean) => {
      const matches = Array.from(root.querySelectorAll(selector)).filter(predicate);
      return matches.length === 1 ? matches[0] : null;
    };
    const anchor = label.kind === 'participantLabel'
      ? exact('[data-et="participant"]', (el) => el.getAttribute('data-id') === label.key)
      : label.kind === 'messageText'
        ? exact('[data-et="message"]', (el) => el.getAttribute('data-id') === `i${label.key}`)
          && elementsOf(root, { kind: 'messageText', key: Number(label.key) })[0]
        : label.kind === 'nodeLabel'
          ? exact('g.node', (el) => el.id === `${root.id}-${label.domId}`)
          : exact('g.edgeLabel g.label[data-id]', (el) => el.getAttribute('data-id') === label.key);
    // Use the exact same parity and support gate as opening the editor, with no side effects.
    const hit = anchor && mapAdapter.hit(anchor, root);
    const began = hit && mapAdapter.begin(hit, map, root, selection.code);
    if (!began || !('open' in began)) {
      approvedSource = null;
      return hideSourceRing();
    }
    const elements = began.open.locate(root, began.open.baseKey);
    if (!elements.length) return hideSourceRing();
    if (approvedSource?.root !== root) hideSourceRing();
    approvedSource = { code: selection.code, label, root, elements, props: {
      ...baseProps(mapAdapter.diagram), inline_edit_kind: began.open.props.inline_edit_kind,
    } };
    showSourceRing(root, showHint);
  }

  const onSourceSelection = (event: Event) => {
    const selection = (event as CustomEvent<MermaidSourceSelection | null>).detail;
    if (selection === null) return clearSourceSelection();
    if (!selection?.owner?.contains(container)) return;
    if ('clear' in selection || deps.isBlocked()) return clearSourceSelection();
    sourceSelection = selection;
    updateSourceSelection();
  };

  const preserveSourceFocus = (event: MouseEvent) => {
    if (event.button !== 0 || !sourceRing || !(event.target instanceof Element)) return;
    if (approvedSource?.elements.some((el) => el.contains(event.target as Element))) event.preventDefault();
  };

  win.addEventListener(MERMAID_SOURCE_SELECTION, onSourceSelection);
  win.addEventListener('blur', clearSourceSelection);
  container.addEventListener('mousedown', preserveSourceFocus);

  return {
    get visible() { return sourceRing !== null; },
    update: updateSourceSelection,
    hide: hideSourceRing,
    clear: clearSourceSelection,
    destroy() {
      win.removeEventListener(MERMAID_SOURCE_SELECTION, onSourceSelection);
      win.removeEventListener('blur', clearSourceSelection);
      container.removeEventListener('mousedown', preserveSourceFocus);
      clearSourceSelection();
    },
  };
}
