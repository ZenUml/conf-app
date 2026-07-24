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
})
