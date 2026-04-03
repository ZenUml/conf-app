import { describe, expect, it } from 'vitest'

import {
  getManifestEditDescriptions,
  getManifestEditYqArgs,
} from '../../scripts/forge-wizard.mjs'

describe('forge-wizard manifest preview helpers', () => {
  it('lite removes licensing and contentBylineItem', () => {
    const desc = getManifestEditDescriptions('lite')
    expect(desc).toContain('Remove licensing (lite is free)')
    expect(desc).toContain('Remove confluence:contentBylineItem')

    const yq = getManifestEditYqArgs('lite').map((x) => x.expr)
    expect(yq).toContain('del(.app.licensing)')
    expect(yq).toContain('del(.modules["confluence:contentBylineItem"])')
  })

  it('full has no manifest deletions', () => {
    expect(getManifestEditDescriptions('full')).toEqual([])
    expect(getManifestEditYqArgs('full')).toEqual([])
  })

  it('diagramly removes global UI modules and embed macro', () => {
    const desc = getManifestEditDescriptions('diagramly')
    expect(desc).toContain('Remove globalSettings + globalPage')
    expect(desc).toContain('Remove embed macro (zenuml-embed-macro)')

    const yq = getManifestEditYqArgs('diagramly').map((x) => x.expr)
    expect(yq).toContain(
      'del(.modules["confluence:globalSettings"]) | del(.modules["confluence:globalPage"])',
    )
    expect(yq).toContain(
      'del(.modules.macro[] | select(.key | test("zenuml-embed-macro")))',
    )
  })
})

