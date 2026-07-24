import { describe, it, expect } from 'vitest'
import { extractGraphText } from './extractGraphText'

const EMPTY_GRAPH = `<mxfile>
  <diagram name="Page-1">
    <mxGraphModel dx="1434" dy="540">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`

describe('extractGraphText', () => {
  it('returns empty string for falsy / non-string input', () => {
    expect(extractGraphText(undefined)).toBe('')
    expect(extractGraphText(null)).toBe('')
    expect(extractGraphText('')).toBe('')
    // @ts-expect-error deliberately wrong type
    expect(extractGraphText(123)).toBe('')
  })

  it('returns empty string for the empty starter graph (no labels)', () => {
    expect(extractGraphText(EMPTY_GRAPH)).toBe('')
  })

  it('collects mxCell value labels', () => {
    const xml = `<mxGraphModel><root>
      <mxCell id="0" />
      <mxCell id="2" value="Start" vertex="1" />
      <mxCell id="3" value="Process order" vertex="1" />
      <mxCell id="4" value="End" vertex="1" />
    </root></mxGraphModel>`
    expect(extractGraphText(xml)).toBe('Start\nProcess order\nEnd')
  })

  it('strips inline HTML and converts <br> to a space', () => {
    const xml = `<mxGraphModel><root>
      <mxCell id="2" value="&lt;b&gt;Order&lt;/b&gt;&lt;br&gt;service" vertex="1" />
    </root></mxGraphModel>`
    expect(extractGraphText(xml)).toBe('Order service')
  })

  it('de-duplicates identical labels', () => {
    const xml = `<mxGraphModel><root>
      <mxCell id="2" value="Lane" vertex="1" />
      <mxCell id="3" value="Lane" vertex="1" />
      <mxCell id="4" value="Task" vertex="1" />
    </root></mxGraphModel>`
    expect(extractGraphText(xml)).toBe('Lane\nTask')
  })

  it('reads object/UserObject label attributes', () => {
    const xml = `<mxGraphModel><root>
      <object label="Customer" id="2"><mxCell vertex="1" /></object>
      <UserObject label="Payment API" id="3"><mxCell vertex="1" /></UserObject>
    </root></mxGraphModel>`
    expect(extractGraphText(xml)).toBe('Customer\nPayment API')
  })

  it('returns empty string for malformed XML', () => {
    expect(extractGraphText('<mxGraphModel><root><mxCell value="oops"')).toBe('')
  })

  it('caps the payload length', () => {
    const many = Array.from({ length: 500 }, (_, i) => `<mxCell id="${i}" value="label-${i}" vertex="1" />`).join('')
    const out = extractGraphText(`<mxGraphModel><root>${many}</root></mxGraphModel>`)
    expect(out.length).toBeLessThanOrEqual(2000)
  })

  describe('shape-only fallback (no text labels)', () => {
    it('describes AWS library stencils by resource name and counts connectors', () => {
      const xml = `<mxGraphModel><root>
        <mxCell id="0" />
        <mxCell id="2" style="shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.ec2;" vertex="1" />
        <mxCell id="3" style="sketch=0;resIcon=mxgraph.aws4.rds;" vertex="1" />
        <mxCell id="4" style="rounded=1;whiteSpace=wrap;" vertex="1" />
        <mxCell id="5" edge="1" source="2" target="3" />
      </root></mxGraphModel>`
      const out = extractGraphText(xml)
      expect(out).toContain('ec2')
      expect(out).toContain('rds')
      expect(out).toContain('1 connector')
    })

    it('describes geometric primitives (rhombus, ellipse)', () => {
      const xml = `<mxGraphModel><root>
        <mxCell id="2" style="rhombus;whiteSpace=wrap;html=1;" vertex="1" />
        <mxCell id="3" style="ellipse;html=1;" vertex="1" />
      </root></mxGraphModel>`
      const out = extractGraphText(xml)
      expect(out).toContain('rhombus')
      expect(out).toContain('ellipse')
    })

    it('aggregates identical plain shapes with a count', () => {
      const xml = `<mxGraphModel><root>
        <mxCell id="2" vertex="1" />
        <mxCell id="3" vertex="1" />
        <mxCell id="4" vertex="1" />
      </root></mxGraphModel>`
      expect(extractGraphText(xml)).toContain('3× box')
    })

    it('describes even a single recognised library stencil', () => {
      const xml = `<mxGraphModel><root>
        <mxCell id="2" style="resIcon=mxgraph.aws4.lambda;" vertex="1" />
      </root></mxGraphModel>`
      expect(extractGraphText(xml)).toContain('lambda')
    })

    it('returns empty for a single blank box (nothing worth titling)', () => {
      const xml = `<mxGraphModel><root>
        <mxCell id="2" style="rounded=1;" vertex="1" />
      </root></mxGraphModel>`
      expect(extractGraphText(xml)).toBe('')
    })

    it('prefers text labels over shape descriptors when both exist', () => {
      const xml = `<mxGraphModel><root>
        <mxCell id="2" value="Login" style="rhombus;" vertex="1" />
        <mxCell id="3" style="ellipse;" vertex="1" />
      </root></mxGraphModel>`
      expect(extractGraphText(xml)).toBe('Login')
    })
  })
})
