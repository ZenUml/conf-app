import type { GraphEditorMode } from '@/utils/graph/graphEditorMode'

export const GRAPH_MODE_SWITCH_CLASS = 'graph-mode-switch'
export const GRAPH_MODE_SWITCH_STYLE_ID = 'zenuml-graph-mode-switch-css'
export const DRAWIO_FILENAME_STYLE_ID = 'zenuml-hide-drawio-filename'

const NOTCH_REF_WIDTH = 252
const NOTCH_REF_HEIGHT = 31
// The classic Diagram menubar renders the switch at 30px in the editor. Keep
// Board's body-mounted switch on that same visual baseline; the sketch toolbar
// itself is 44px tall, but its chrome size must not change our control.
const DIAGRAM_SWITCH_HEIGHT = 30
const NOTCH_REF_INSET = 37.5
const MIN_VISIBLE_WIDTH = 100

const FILL_PATH = `
  M 0 0
  C 10 0, 13 4, 18 12
  L 25 24
  C 27.5 28.5, 32 31, 37.5 31
  H 214.5
  C 220 31, 224.5 28.5, 227 24
  L 234 12
  C 239 4, 242 0, 252 0
  Z
`

const STROKE_PATH = `
  M 0 0
  C 10 0, 13 4, 18 12
  L 25 24
  C 27.5 28.5, 32 31, 37.5 31
  H 214.5
  C 220 31, 224.5 28.5, 227 24
  L 234 12
  C 239 4, 242 0, 252 0
`

const SWITCH_CSS = `
.graph-mode-switch {
  position: absolute;
  z-index: 10;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  pointer-events: none;
}
.graph-mode-switch__shape {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  filter: drop-shadow(0 2px 4px rgb(9 30 66 / 12%));
  pointer-events: none;
}
.graph-mode-switch__controls {
  position: absolute;
  top: 0;
  bottom: 0;
  display: grid;
  grid-template-columns: 1fr 1px 1fr;
  align-items: center;
  pointer-events: auto;
}
.graph-mode-switch button {
  position: relative;
  border: 0;
  background: transparent;
  color: #626f86;
  font: 600 13px/1 system-ui, sans-serif;
  cursor: pointer;
}
.graph-mode-switch button[aria-pressed="true"] {
  color: #172b4d;
}
.graph-mode-switch button[aria-pressed="true"]::after {
  content: "";
  position: absolute;
  right: 20px;
  bottom: 1px;
  left: 20px;
  height: 2px;
  border-radius: 1px;
  background: #0c66e4;
}
.graph-mode-switch button:focus {
  outline: none;
}
.graph-mode-switch button:focus-visible {
  outline: 2px solid #0c66e4;
  outline-offset: -2px;
}
.graph-mode-switch__divider {
  width: 1px;
  height: 19px;
  background: #dfe1e6;
}
`

export type GraphModeSwitchOptions = {
  mode: GraphEditorMode
  onSelect: (mode: GraphEditorMode) => void
  reservedLeftPx?: number
  reservedRightPx?: number
}

function measureBox(el: HTMLElement): { width: number; height: number } {
  const rect = el.getBoundingClientRect()
  const width = rect.width || el.offsetWidth || parseFloat(el.style.width) || 0
  const height = rect.height || el.offsetHeight || parseFloat(el.style.height) || 0
  return { width, height }
}

function ensureStyle(doc: Document, id: string, css: string) {
  const host = doc.head || doc.documentElement
  if (!host) return
  let style = doc.getElementById(id) as HTMLStyleElement | null
  if (!style) {
    style = doc.createElement('style')
    style.id = id
    host.appendChild(style)
  }
  style.textContent = css
}

function isVisibleMenubar(el: HTMLElement): boolean {
  const computed = el.ownerDocument.defaultView?.getComputedStyle(el)
    || (typeof getComputedStyle === 'function' ? getComputedStyle(el) : undefined)
  if (computed?.display === 'none' || computed?.visibility === 'hidden') return false
  const rect = el.getBoundingClientRect()
  const height = rect.height || el.offsetHeight || parseFloat(el.style.height) || 0
  return height > 8
}

export function findDrawioMenubar(doc: Document): HTMLElement | null {
  const candidates = [
    ...doc.querySelectorAll('.geMenubarContainer, .geToolbarContainer.geSimpleMainMenu, .geToolbarContainer'),
  ] as HTMLElement[]
  const visible = candidates.filter(isVisibleMenubar)
  const classic = visible.find((el) =>
    el.classList.contains('geMenubarContainer') && !!el.querySelector('.geMenubar')
  )
  if (classic) return classic

  const scored = visible
    .map((el) => {
      const rect = el.getBoundingClientRect()
      const top = rect.top
      const width = rect.width || el.offsetWidth
      const height = rect.height || el.offsetHeight
      const topScore = top < 12 ? 2000 : top < 80 ? 400 : 0
      const wideScore = width > height * 2 ? width : -height
      return { el, score: topScore + wideScore }
    })
    .sort((a, b) => b.score - a.score)
  return scored[0]?.el || (doc.querySelector('.geMenubarContainer') as HTMLElement | null)
}

export function hideDrawioFilename(doc: Document) {
  ensureStyle(doc, DRAWIO_FILENAME_STYLE_ID, `
    .geFilename,
    .geDiagramTitle,
    .geDiagramName,
    #geFilename {
      display: none !important;
    }
  `)
  doc.querySelectorAll('.geFilename, .geDiagramTitle, .geDiagramName, #geFilename').forEach((el) => {
    (el as HTMLElement).style.display = 'none'
  })
  doc.querySelectorAll('.geMenubarContainer a.geItem').forEach((el) => {
    const node = el as HTMLElement
    if (node.style.fontSize === '18px') node.style.display = 'none'
  })
}

function activate(mode: GraphEditorMode, current: GraphEditorMode, onSelect: GraphModeSwitchOptions['onSelect']) {
  if (mode === current) return
  onSelect(mode)
}

export function injectGraphModeSwitch(menubar: HTMLElement, options: GraphModeSwitchOptions): HTMLElement {
  const doc = menubar.ownerDocument
  ensureStyle(doc, GRAPH_MODE_SWITCH_STYLE_ID, SWITCH_CSS)
  // The sketch UI's toolbars are transient and have `overflow: hidden`; DrawIO
  // may replace them while the editor finishes booting. Remove an earlier
  // switch from either the old toolbar or the stable document host before
  // mounting the replacement.
  // querySelectorAll, not querySelector: the mount target is the toolbar OR
  // the document body depending on the chrome, and scheduleMountModeSwitch
  // retries on a timer — a single removal could leave a stale switch behind.
  doc.querySelectorAll(`.${GRAPH_MODE_SWITCH_CLASS}`).forEach((el) => el.remove())

  const box = measureBox(menubar)
  const isShortToolbar = box.height > 8 && box.height <= 80
  const looksLikeTopBar = isShortToolbar && box.width >= 200
  const isClassicMenubar = menubar.classList.contains('geMenubarContainer')
    && !!menubar.querySelector('.geMenubar')
  const mountTarget = isClassicMenubar || !isShortToolbar
    ? menubar
    : (doc.body || doc.documentElement)
  const mountOutsideToolbar = mountTarget !== menubar
  const height = mountOutsideToolbar
    ? DIAGRAM_SWITCH_HEIGHT
    : (isShortToolbar ? box.height : NOTCH_REF_HEIGHT)
  const heightScale = height / NOTCH_REF_HEIGHT
  let width = NOTCH_REF_WIDTH * heightScale

  const reservedLeft = options.reservedLeftPx ?? 0
  const reservedRight = options.reservedRightPx ?? 0
  // A body-mounted sketch control is independent of the transient toolbar's
  // dimensions and its overflow boundary. Keep the canonical Diagram width;
  // only stable, in-toolbar mounts participate in reserved-space fitting.
  const available = mountOutsideToolbar
    ? width
    : (box.width > 0 ? box.width - reservedLeft - reservedRight : width)
  if (available > 0 && width > available) {
    width = available
  }

  const root = doc.createElement('div')
  root.className = GRAPH_MODE_SWITCH_CLASS
  root.setAttribute('role', 'group')
  root.setAttribute('aria-label', 'Editor mode')
  // Classic DrawIO keeps its menubar stable, so preserve the original
  // relative/absolute placement. Sketch/Board toolbars are replaced during
  // startup and clip descendants; a fixed body-level host survives both.
  root.style.position = mountOutsideToolbar ? 'fixed' : (looksLikeTopBar ? 'absolute' : 'fixed')
  root.style.zIndex = '10'
  root.style.top = '0px'
  root.style.left = '50%'
  root.style.transform = 'translateX(-50%)'
  root.style.width = `${width}px`
  root.style.height = `${height}px`
  // A body-mounted switch is centred with position:fixed, so the constraint is
  // the VIEWPORT, not the transient toolbar it was measured from. Without this
  // the hide guard could never fire in Board mode and the 252px control was
  // drawn over the sketch chrome on a narrow modal.
  const fitWidth = mountOutsideToolbar
    ? (doc.defaultView?.innerWidth ?? doc.documentElement?.clientWidth ?? 0)
    : available
  if (fitWidth > 0 && fitWidth < MIN_VISIBLE_WIDTH) {
    root.style.display = 'none'
  }

  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('class', 'graph-mode-switch__shape')
  svg.setAttribute('viewBox', `0 0 ${NOTCH_REF_WIDTH} ${NOTCH_REF_HEIGHT}`)
  svg.setAttribute('preserveAspectRatio', 'none')
  svg.setAttribute('aria-hidden', 'true')

  const fill = doc.createElementNS('http://www.w3.org/2000/svg', 'path')
  fill.setAttribute('d', FILL_PATH)
  fill.setAttribute('fill', 'white')
  svg.appendChild(fill)

  const stroke = doc.createElementNS('http://www.w3.org/2000/svg', 'path')
  stroke.setAttribute('d', STROKE_PATH)
  stroke.setAttribute('fill', 'none')
  stroke.setAttribute('stroke', '#c1c7d0')
  stroke.setAttribute('stroke-width', '1')
  svg.appendChild(stroke)
  root.appendChild(svg)

  const controls = doc.createElement('div')
  controls.className = 'graph-mode-switch__controls'
  const inset = NOTCH_REF_INSET * (width / NOTCH_REF_WIDTH)
  controls.style.left = `${inset}px`
  controls.style.right = `${inset}px`

  const diagramBtn = doc.createElement('button')
  diagramBtn.type = 'button'
  diagramBtn.textContent = 'Diagram'
  diagramBtn.setAttribute('aria-pressed', options.mode === 'diagram' ? 'true' : 'false')
  diagramBtn.style.height = `${height}px`
  diagramBtn.style.fontSize = `${13 * Math.min(1, heightScale)}px`

  const boardBtn = doc.createElement('button')
  boardBtn.type = 'button'
  boardBtn.textContent = 'Board'
  boardBtn.setAttribute('aria-pressed', options.mode === 'board' ? 'true' : 'false')
  boardBtn.style.height = `${height}px`
  boardBtn.style.fontSize = `${13 * Math.min(1, heightScale)}px`

  const divider = doc.createElement('span')
  divider.className = 'graph-mode-switch__divider'
  divider.setAttribute('aria-hidden', 'true')
  divider.style.height = `${19 * heightScale}px`

  const bind = (btn: HTMLButtonElement, mode: GraphEditorMode) => {
    btn.addEventListener('click', () => activate(mode, options.mode, options.onSelect))
    btn.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        activate(mode, options.mode, options.onSelect)
      }
    })
  }
  bind(diagramBtn, 'diagram')
  bind(boardBtn, 'board')

  controls.append(diagramBtn, divider, boardBtn)
  root.appendChild(controls)

  if (!mountOutsideToolbar) {
    const computed = getComputedStyle(menubar)
    if (computed.position === 'static' || !computed.position) {
      menubar.style.position = 'relative'
    }
  }
  mountTarget.appendChild(root)
  return root
}
