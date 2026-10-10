import { describe, it, expect } from 'vitest'
import {
  MIN_TITLE_CHARS,
  controlsWidth,
  maxHeaderStage,
  moreMenuItems,
  pickHeaderStage,
  visibleTitleChars,
  type HeaderModel,
  type HeaderStage,
} from './viewerHeaderLayout'

// Deterministic stand-ins for canvas measureText (jsdom has no canvas): the
// title (600 14px) averages ~7.5px a glyph, a 13px button label ~7px, a 12px
// chip label ~6.5px. The stage logic only needs widths to be monotonic in
// length; the exact font metrics come from the browser at runtime.
const measureTitle = (text: string) => text.length * 7.5
const measureLabel = (text: string, size: 12 | 13) => text.length * (size === 13 ? 7 : 6.5)

// The three macros the Claude Design prototype (viewer-header-prototype.dc.html,
// MACROS) is built around.
const MERMAID_LONG = {
  title: 'Checkout service: order placement with payment retry and inventory compensation',
  model: { hasSource: true, magic: true, pages: 0, hasEdit: true } satisfies HeaderModel,
}
const PLANTUML_SHORT = {
  title: 'Auth token refresh',
  model: { hasSource: true, magic: false, pages: 0, hasEdit: true } satisfies HeaderModel,
}
const GRAPH_PAGES = {
  title: 'Payments platform regional deployment topology (EU-West, US-East, failover)',
  model: { hasSource: false, magic: false, pages: 3, hasEdit: true } satisfies HeaderModel,
}

// Prototype geometry: 1px frame border each side, 12px header padding each
// side, 12px between the title area and the controls.
const CHROME = 2 + 24 + 12
const stageAt = (fixture: { title: string; model: HeaderModel }, column: number) =>
  pickHeaderStage({
    title: fixture.title,
    maxStage: maxHeaderStage(fixture.model),
    measureTitle,
    titleSpaceAt: (s) => column - CHROME - controlsWidth(fixture.model, s, measureLabel),
  })

describe('viewerHeaderLayout', () => {
  describe('visibleTitleChars', () => {
    it('returns the whole title when it fits', () => {
      expect(visibleTitleChars('Auth token refresh', 1000, measureTitle)).toBe(18)
    })

    it('counts the characters that fit in front of the ellipsis when truncated', () => {
      // 10 chars + '…' = 11 glyphs * 7.5 = 82.5 <= 85; 11 chars + '…' = 90 > 85.
      expect(visibleTitleChars('abcdefghijklmnopqrstuvwxyz', 85, measureTitle)).toBe(10)
    })

    it('returns 0 when not even one character fits', () => {
      expect(visibleTitleChars('abc', 5, measureTitle)).toBe(0)
      expect(visibleTitleChars('abc', -40, measureTitle)).toBe(0)
    })
  })

  describe('maxHeaderStage', () => {
    it('allows stage 3 (Source + Copy for AI into More) only when the diagram has source', () => {
      expect(maxHeaderStage(MERMAID_LONG.model)).toBe(3)
      expect(maxHeaderStage(GRAPH_PAGES.model)).toBe(2)
    })
  })

  describe('controlsWidth', () => {
    it('shrinks monotonically through the stages', () => {
      for (const { model } of [MERMAID_LONG, PLANTUML_SHORT, GRAPH_PAGES]) {
        const widths = [0, 1, 2, 3].map(s => controlsWidth(model, s as HeaderStage, measureLabel))
        for (let i = 1; i < widths.length; i++) expect(widths[i]).toBeLessThanOrEqual(widths[i - 1])
      }
    })

    it('only changes at stage 3 when the diagram has source to move', () => {
      expect(controlsWidth(GRAPH_PAGES.model, 3, measureLabel)).toBe(controlsWidth(GRAPH_PAGES.model, 2, measureLabel))
      expect(controlsWidth(PLANTUML_SHORT.model, 3, measureLabel)).toBeLessThan(controlsWidth(PLANTUML_SHORT.model, 2, measureLabel))
    })

    it('makes Edit icon-only at stage 1 only when Edit is present', () => {
      const noEdit = { ...PLANTUML_SHORT.model, hasEdit: false }
      expect(controlsWidth(noEdit, 0, measureLabel)).toBe(controlsWidth(noEdit, 1, measureLabel))
    })

    it('reserves the page navigation width for multi-page diagrams', () => {
      const one = { ...GRAPH_PAGES.model, pages: 1 }
      expect(controlsWidth(GRAPH_PAGES.model, 0, measureLabel)).toBeGreaterThan(controlsWidth(one, 0, measureLabel))
    })
  })

  describe('pickHeaderStage — prototype fixtures', () => {
    // Expected stage per column width. Read as: the smallest stage at which
    // the title still shows >= min(24, title.length) characters. 400 and 500
    // are below the desktop 560px floor; they exercise stages 2 and 3, which
    // a real header reaches sooner once Create / Connect / slot actions add
    // their own width (the component measures those).
    it.each([
      [400, 3], [500, 2], [560, 1], [680, 0], [760, 0], [1000, 0],
    ])('long Mermaid title with source + Refined at %ipx → stage %i', (column, stage) => {
      expect(stageAt(MERMAID_LONG, column).stage).toBe(stage)
    })

    it.each([560, 680, 760, 1000])('short PlantUML title keeps every label at %ipx', (column) => {
      const result = stageAt(PLANTUML_SHORT, column)
      expect(result.stage).toBe(0)
      expect(result.chars).toBe(PLANTUML_SHORT.title.length)
    })

    it.each([
      [400, 2], [500, 2], [560, 1], [680, 0], [760, 0], [1000, 0],
    ])('3-page Graph with a long title and no source at %ipx → stage %i', (column, stage) => {
      expect(stageAt(GRAPH_PAGES, column).stage).toBe(stage)
    })

    it('never goes past stage 2 for a diagram without source, even when the title is crushed', () => {
      expect(stageAt(GRAPH_PAGES, 300).stage).toBe(2)
    })

    it('stops at the last stage and reports what is visible there when nothing satisfies the minimum', () => {
      const result = stageAt(MERMAID_LONG, 300)
      expect(result.stage).toBe(3)
      expect(result.chars).toBeLessThan(MIN_TITLE_CHARS)
    })

    it('is monotonic: a wider column never needs a higher stage', () => {
      for (const fixture of [MERMAID_LONG, PLANTUML_SHORT, GRAPH_PAGES]) {
        let previous = 3
        for (let column = 400; column <= 1200; column += 10) {
          const { stage } = stageAt(fixture, column)
          expect(stage).toBeLessThanOrEqual(previous)
          previous = stage
        }
      }
    })

    it('shows at least the minimum number of title characters at the chosen stage', () => {
      for (const fixture of [MERMAID_LONG, GRAPH_PAGES]) {
        for (const column of [560, 680, 760, 1000]) {
          const { chars } = stageAt(fixture, column)
          expect(chars).toBeGreaterThanOrEqual(Math.min(MIN_TITLE_CHARS, fixture.title.length))
        }
      }
    })

    it('treats a title shorter than the minimum as satisfied once it is fully visible', () => {
      const result = pickHeaderStage({
        title: 'Flow',
        maxStage: 3,
        measureTitle,
        titleSpaceAt: (s) => [10, 20, 40, 400][s],
      })
      expect(result).toEqual({ stage: 2, chars: 4, titleSpace: 40 })
    })
  })

  describe('moreMenuItems', () => {
    const base = { hasSource: true, isCustomContent: true, hasDeeplinkHost: true, fullscreen: false }

    it('lists the former bottom-pill actions, then debug info, below stage 3', () => {
      for (const stage of [0, 1, 2] as HeaderStage[]) {
        expect(moreMenuItems({ ...base, stage })).toEqual([
          'copy-diagram-link', 'copy-page-link', 'export-png', 'versions', 'separator', 'debug',
        ])
      }
    })

    it('leads with Source and Copy for AI at stage 3', () => {
      expect(moreMenuItems({ ...base, stage: 3 })).toEqual([
        'source', 'copy-for-ai', 'separator',
        'copy-diagram-link', 'copy-page-link', 'export-png', 'versions', 'separator', 'debug',
      ])
    })

    it('lists Connect MCP in place of Copy for AI when it holds that slot', () => {
      expect(moreMenuItems({ ...base, connectMcp: true, stage: 3 }).slice(0, 3)).toEqual([
        'source', 'connect-mcp', 'separator',
      ])
      expect(moreMenuItems({ ...base, connectMcp: true, stage: 2 })).not.toContain('connect-mcp')
    })

    it('never lists Source or Copy for AI for a diagram without source', () => {
      expect(moreMenuItems({ ...base, hasSource: false, stage: 3 })).toEqual([
        'copy-diagram-link', 'copy-page-link', 'export-png', 'versions', 'separator', 'debug',
      ])
    })

    it('drops Copy diagram link and Versions without custom content', () => {
      expect(moreMenuItems({ ...base, isCustomContent: false, stage: 0 })).toEqual([
        'copy-page-link', 'export-png', 'separator', 'debug',
      ])
    })

    it('drops Copy diagram link when the variant has no deeplink host (asyncapi)', () => {
      expect(moreMenuItems({ ...base, hasDeeplinkHost: false, stage: 0 })).toEqual([
        'copy-page-link', 'export-png', 'versions', 'separator', 'debug',
      ])
    })

    it('holds only Download debug info in Fullscreen, whose header shows the rest as buttons', () => {
      expect(moreMenuItems({ ...base, fullscreen: true, stage: 3 })).toEqual(['debug'])
    })
  })
})
