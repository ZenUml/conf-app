import { describe, expect, it } from 'vitest'

import {
  getManifestEditDescriptions,
  getManifestEditYqArgs,
} from '../../scripts/forge-wizard.mjs'

describe('forge-wizard manifest preview helpers', () => {
  it('lite removes licensing, contentBylineItem, and asyncapi bits', () => {
    const desc = getManifestEditDescriptions('lite')
    expect(desc).toContain('Remove licensing (lite is free)')
    expect(desc).toContain('Remove confluence:contentBylineItem')
    expect(desc).toContain('Remove asyncapi macro (zenuml-asyncapi-macro)')
    expect(desc).toContain('Remove asyncapi custom content (zenuml-content-asyncapi)')

    const yq = getManifestEditYqArgs('lite').map((x) => x.expr)
    expect(yq).toContain('del(.app.licensing)')
    expect(yq).toContain('del(.modules["confluence:contentBylineItem"])')
    expect(yq).toContain(
      'del(.modules.macro[] | select(.key | test("zenuml-asyncapi-macro")))',
    )
    expect(yq).toContain(
      'del(.modules["confluence:customContent"][] | select(.key | test("zenuml-content-asyncapi")))',
    )
  })

  it('full only strips asyncapi bits', () => {
    // Full is the "base" variant — it shares all the ZenUML/Mermaid/Graph/
    // OpenAPI/Embed macros with the base manifest, and only needs to strip
    // the AsyncAPI macro + custom content (which live in the base manifest
    // so the asyncapi variant can keep them).
    const desc = getManifestEditDescriptions('full')
    expect(desc).toEqual([
      'Remove asyncapi macro (zenuml-asyncapi-macro)',
      'Remove asyncapi custom content (zenuml-content-asyncapi)',
    ])
    const yq = getManifestEditYqArgs('full').map((x) => x.expr)
    expect(yq).toEqual([
      'del(.modules.macro[] | select(.key | test("zenuml-asyncapi-macro")))',
      'del(.modules["confluence:customContent"][] | select(.key | test("zenuml-content-asyncapi")))',
    ])
  })

  it('diagramly removes global UI modules, embed, and asyncapi bits', () => {
    const desc = getManifestEditDescriptions('diagramly')
    expect(desc).toContain('Remove globalSettings + globalPage')
    expect(desc).toContain('Remove embed macro (zenuml-embed-macro)')
    expect(desc).toContain('Remove asyncapi macro (zenuml-asyncapi-macro)')
    expect(desc).toContain('Remove asyncapi custom content (zenuml-content-asyncapi)')

    const yq = getManifestEditYqArgs('diagramly').map((x) => x.expr)
    expect(yq).toContain(
      'del(.modules["confluence:globalSettings"]) | del(.modules["confluence:globalPage"])',
    )
    expect(yq).toContain(
      'del(.modules.macro[] | select(.key | test("zenuml-embed-macro")))',
    )
    expect(yq).toContain(
      'del(.modules.macro[] | select(.key | test("zenuml-asyncapi-macro")))',
    )
  })

  it('asyncapi strips licensing, non-asyncapi macros, and grants unsafe-eval', () => {
    const desc = getManifestEditDescriptions('asyncapi')
    expect(desc).toContain('Remove licensing (asyncapi MVP is free)')
    expect(desc).toContain('Remove non-asyncapi macros (sequence, openapi, graph, embed)')
    expect(desc).toContain(
      "Allow 'unsafe-eval' in CSP (required by AsyncAPI Studio runtime schema compilation)",
    )

    const yq = getManifestEditYqArgs('asyncapi').map((x) => x.expr)
    expect(yq).toContain(
      'del(.modules.macro[] | select(.key | test("zenuml-asyncapi-macro") | not))',
    )
    expect(yq).toContain('.permissions.content.scripts = ["unsafe-eval"]')
  })
})

