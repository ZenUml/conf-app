export type GraphEditorMode = 'diagram' | 'board'

export const DEFAULT_GRAPH_EDITOR_MODE: GraphEditorMode = 'diagram'

/** Macro config key. Single source of truth for persisted chrome mode. */
export const GRAPH_EDITOR_MODE_CONFIG_KEY = 'graphEditorMode'

// Do not pass offline=1 here. DrawIO v31 treats the embedded editor as a
// standalone app in that mode and hides its existing embed button container;
// the Publish button is still created, but becomes zero-sized/inaccessible.
// lockdown=1 keeps external-data communications disabled without entering the
// standalone-app path, so Publish remains visible in both Diagram and Board.
const DRAWIO_EDITOR_BASE_QUERY =
  'embed=1&spin=1&proto=json&noSaveBtn=1&saveAndExit=1&publishClose=1&noExitBtn=1&libraries=1&lockdown=1'

let currentMode: GraphEditorMode = DEFAULT_GRAPH_EDITOR_MODE

export function normalizeGraphEditorMode(value: unknown): GraphEditorMode {
  return value === 'board' ? 'board' : DEFAULT_GRAPH_EDITOR_MODE
}

export function getGraphEditorMode(): GraphEditorMode {
  return currentMode
}

export function setGraphEditorMode(value: unknown): GraphEditorMode {
  currentMode = normalizeGraphEditorMode(value)
  return currentMode
}

export function buildDrawioEditorSrc(mode: unknown): string {
  const normalized = normalizeGraphEditorMode(mode)
  const base = `./drawio/index.html?${DRAWIO_EDITOR_BASE_QUERY}`
  if (normalized === 'board') {
    return `${base}&ui=sketch&sketch=1`
  }
  return base
}

export function captureXmlForModeSwitch(args: {
  latestXml?: string | null
  graphXml?: string | null
}): string | null {
  return args.latestXml || args.graphXml || null
}

export function countMxfilePages(xml: string): number {
  const matches = xml.match(/<diagram[\s>]/g)
  return matches ? matches.length : 0
}

export function countMxCells(xml: string): number {
  const matches = xml.match(/<mxCell\b/g)
  return matches ? matches.length : 0
}

export function mxfileContentFingerprint(xml: string): {
  pages: number
  cells: number
  length: number
} {
  return {
    pages: countMxfilePages(xml),
    cells: countMxCells(xml),
    length: xml.length,
  }
}

export function wasContentPreserved(before: string, after: string): boolean {
  const a = mxfileContentFingerprint(before)
  const b = mxfileContentFingerprint(after)
  return a.pages === b.pages && a.cells === b.cells
}
