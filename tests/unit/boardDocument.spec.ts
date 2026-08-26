import { describe, expect, it } from 'vitest'
import {
  getBoardDocumentLoadError,
  graphModeFromDoc,
  isLegacyBoardDocument,
  resolveGraphEditorMode,
  resolveGraphXml,
  resolveGraphXmlForMode,
  validateBoardXml,
} from '@/utils/graph/boardDocument'
import { DiagramType, getDiagramData } from '@/model/Diagram/Diagram'

const DIAGRAM = '<mxfile><diagram name="Diagram"><mxGraphModel><root /></mxGraphModel></diagram></mxfile>'
const BOARD = '<mxfile><diagram name="Board"><mxGraphModel><root /></mxGraphModel></diagram></mxfile>'

const doc = (extra: Record<string, unknown> = {}) => ({
  diagramType: DiagramType.Graph,
  graphXml: DIAGRAM,
  ...extra,
}) as any

describe('boardDocument — mode resolution', () => {
  it('reads the mode off the body when it is recorded there', () => {
    expect(graphModeFromDoc(doc({ graphEditorMode: 'board' }))).toBe('board')
    expect(graphModeFromDoc(doc({ graphEditorMode: 'diagram' }))).toBe('diagram')
  })

  it('reports no recorded mode for a legacy body', () => {
    expect(graphModeFromDoc(doc())).toBeUndefined()
  })

  it('normalizes an unknown recorded mode to diagram', () => {
    expect(graphModeFromDoc(doc({ graphEditorMode: 'whiteboard' }))).toBe('diagram')
  })

  // forge-graph-editor.ts closes the view WITHOUT submitting config when
  // needsWriteback and isConfiguring are both false, so a config value can lag
  // the body by a whole session. The body is written in the same publish as
  // the content it describes, so it wins.
  it('prefers the body over a stale macro config', () => {
    expect(resolveGraphEditorMode(doc({ graphEditorMode: 'board' }), 'diagram')).toBe('board')
    expect(resolveGraphEditorMode(doc({ graphEditorMode: 'diagram' }), 'board')).toBe('diagram')
  })

  it('falls back to the macro config for a legacy body that records no mode', () => {
    expect(resolveGraphEditorMode(doc(), 'board')).toBe('board')
    expect(resolveGraphEditorMode(doc(), undefined)).toBe('diagram')
  })
})

describe('boardDocument — legacy Board records', () => {
  // Board mode shipped in v2026.08.250259-diagramly (the published Diagramly
  // release) before boardGraphXml existed. Those macros carry NO boardGraphXml
  // field and hold their body in graphXml.
  it('treats an absent boardGraphXml with a real graphXml as the legacy shape', () => {
    expect(isLegacyBoardDocument(doc())).toBe(true)
  })

  it('does not treat an EMPTY boardGraphXml as legacy', () => {
    expect(isLegacyBoardDocument(doc({ boardGraphXml: '' }))).toBe(false)
  })

  it('does not treat an empty graphXml as a legacy Board body', () => {
    expect(isLegacyBoardDocument(doc({ graphXml: '   ' }))).toBe(false)
  })

  it('resolves the legacy body for Board mode', () => {
    expect(resolveGraphXmlForMode(doc(), 'board')).toBe(DIAGRAM)
  })

  it('resolves the independent Board body once one exists', () => {
    expect(resolveGraphXmlForMode(doc({ boardGraphXml: BOARD }), 'board')).toBe(BOARD)
  })

  it('never returns the Board body for Diagram mode', () => {
    expect(resolveGraphXmlForMode(doc({ boardGraphXml: BOARD }), 'diagram')).toBe(DIAGRAM)
  })

  // A publish writes BOTH documents, so "boardGraphXml when non-empty" would
  // resolve a Diagram macro to the Board body as soon as its owner had once
  // drawn on the Board. The recorded mode is what disambiguates.
  it('resolves a Diagram-mode macro that also holds Board content to the Diagram body', () => {
    const both = doc({ boardGraphXml: BOARD, graphEditorMode: 'diagram' })
    expect(resolveGraphXml(both)).toBe(DIAGRAM)
    expect(getDiagramData(both)).toBe(DIAGRAM)
  })

  it('resolves a Board-mode macro that also holds Diagram content to the Board body', () => {
    const both = doc({ boardGraphXml: BOARD, graphEditorMode: 'board' })
    expect(resolveGraphXml(both)).toBe(BOARD)
    expect(getDiagramData(both)).toBe(BOARD)
  })

  it('resolves a legacy Board macro through the macro config', () => {
    expect(resolveGraphXml(doc(), 'board')).toBe(DIAGRAM)
  })
})

describe('boardDocument — validation', () => {
  it('accepts mxfile and raw mxGraphModel roots', () => {
    expect(validateBoardXml(BOARD)).toBeNull()
    expect(validateBoardXml('<mxGraphModel><root /></mxGraphModel>')).toBeNull()
  })

  it('names the three unrenderable shapes', () => {
    expect(validateBoardXml(undefined)).toBe('board_document_missing')
    expect(validateBoardXml(null)).toBe('board_document_malformed')
    expect(validateBoardXml(42)).toBe('board_document_malformed')
    expect(validateBoardXml(' \n\t ')).toBe('board_document_empty')
  })

  it('rejects unparseable XML and unexpected roots', () => {
    expect(validateBoardXml('<mxfile><diagram name="Board">')).toBe('board_document_malformed')
    expect(validateBoardXml('<html><body /></html>')).toBe('board_document_malformed')
  })

  it('returns no load error for a legacy Board record', () => {
    expect(getBoardDocumentLoadError(doc())).toBeNull()
  })

  it('marks a genuinely invalid Board document terminal so it beats a renderable graphXml', () => {
    expect(getBoardDocumentLoadError(doc({ boardGraphXml: '' }))).toEqual({
      errorClass: 'malformed',
      errorCode: 'board_document_empty',
      terminal: true,
    })
  })

  it('returns no load error for a valid Board document', () => {
    expect(getBoardDocumentLoadError(doc({ boardGraphXml: BOARD }))).toBeNull()
  })
})
