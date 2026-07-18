import fs from 'node:fs'

import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

import {
  getManifestEditDescriptions,
  getManifestEditYqArgs,
} from '../../scripts/forge-wizard.mjs'

describe('forge-wizard manifest preview helpers', () => {
  it('base manifest defines the Lite daily snapshot with backend timeout and EUD storage', () => {
    const manifest = load(fs.readFileSync('manifest.yml', 'utf8')) as any
    expect(manifest.modules.scheduledTrigger).toContainEqual({
      key: 'lite-macro-count-daily',
      function: 'macroCountSnapshotScheduled',
      interval: 'day',
    })
    expect(manifest.modules.function).toContainEqual({
      key: 'macroCountSnapshotScheduled',
      handler: 'macro-count-snapshot.scheduledHandler',
      timeoutSeconds: 900,
    })
    const connect = manifest.remotes.find((remote: any) => remote.key === 'connect')
    expect(connect.operations).toContain('storage')
    expect(connect.storage).toEqual({ inScopeEUD: true })
  })

  it('lite strips licensing, contentBylineItem, and asyncapi bits', () => {
    const desc = getManifestEditDescriptions('lite')
    expect(desc).toContain('Remove licensing (lite is free)')
    expect(desc).toContain('Remove confluence:contentBylineItem')
    // Single edit strips both zenuml-asyncapi-macro + zenuml-asyncapi-embed-macro.
    expect(desc).toContain(
      'Remove asyncapi macros (zenuml-asyncapi-macro + zenuml-asyncapi-embed-macro)',
    )
    expect(desc).toContain('Remove asyncapi custom content (async-api-doc)')
    expect(desc).toContain('Remove asyncapi spacePage (zenuml-asyncapi-dashboard-page)')
    expect(desc).toContain('Remove Connect lifecycle module (connectModules)')
    expect(desc).toContain('Remove Diagramly demo-page modules (Lite keeps only macro snapshot schedule)')

    const yq = getManifestEditYqArgs('lite').map((x) => x.expr)
    expect(yq).toContain('del(.app.licensing)')
    expect(yq).toContain('del(.modules["confluence:contentBylineItem"])')
    expect(yq).toContain(
      'del(.modules.macro[] | select(.key | test("zenuml-asyncapi")))',
    )
    expect(yq).toContain(
      'del(.modules["confluence:customContent"][] | select(.key | test("async-api-doc")))',
    )
    expect(yq).toContain('del(.modules["confluence:spacePage"])')
    expect(yq).toContain('del(.connectModules)')
    expect(yq.join(' ')).not.toContain('macroCountSnapshotScheduled')
  })

  it('full strips asyncapi bits and the Connect lifecycle module', () => {
    // Full is the "base" variant — it shares all the ZenUML/Mermaid/Graph/
    // OpenAPI/Embed macros with the base manifest, and only needs to strip
    // the AsyncAPI bits (macros + custom content + spacePage) which live in
    // the base manifest so the asyncapi variant can keep them, plus the
    // Connect lifecycle module (connectModules) — also asyncapi-only.
    const desc = getManifestEditDescriptions('full')
    expect(desc).toContain('Remove Lite snapshot and Diagramly demo schedules from Full')
    expect(desc).toContain('Remove Lite remote-storage declaration from Full')
    expect(getManifestEditYqArgs('full').map((x) => x.expr)).toContain(
      'del(.connectModules)',
    )
    expect(getManifestEditYqArgs('full').map((x) => x.expr).join(' '))
      .toContain('macroCountSnapshotScheduled')
  })

  it('diagramly strips global UI modules, embed, and asyncapi bits', () => {
    const desc = getManifestEditDescriptions('diagramly')
    expect(desc).toContain('Remove globalSettings + globalPage + spacePage')
    expect(desc).toContain('Remove embed macro (zenuml-embed-macro)')
    expect(desc).toContain(
      'Remove asyncapi macros (zenuml-asyncapi-macro + zenuml-asyncapi-embed-macro)',
    )
    expect(desc).toContain('Remove asyncapi custom content (async-api-doc)')
    expect(desc).toContain('Remove Connect lifecycle module (connectModules)')
    expect(desc).toContain('Remove Lite macro snapshot schedule from Diagramly')
    expect(desc).toContain('Remove Lite remote-storage declaration from Diagramly')
    // Diagramly's globalSettings+globalPage+spacePage strip removes both
    // the ZenUML dashboard and the asyncapi spacePage in a single edit.

    const yq = getManifestEditYqArgs('diagramly').map((x) => x.expr)
    expect(yq).toContain(
      'del(.modules["confluence:globalSettings"]) | del(.modules["confluence:globalPage"]) | del(.modules["confluence:spacePage"])',
    )
    expect(yq).toContain(
      'del(.modules.macro[] | select(.key | test("zenuml-embed-macro")))',
    )
    expect(yq).toContain(
      'del(.modules.macro[] | select(.key | test("zenuml-asyncapi")))',
    )
    expect(yq).toContain('del(.connectModules)')
    expect(yq.join(' ')).toContain('macroCountSnapshotScheduled')
  })

  it('asyncapi strips non-asyncapi modules, keeps spacePage + licensing, grants unsafe-eval', () => {
    // Licensing now stays enabled to match the standalone AsyncAPI-Conf-V2
    // manifest — no `del(.app.licensing)` edit on this variant.
    const desc = getManifestEditDescriptions('asyncapi')
    expect(desc).not.toContain('Remove licensing (asyncapi MVP is free)')
    expect(desc).toContain(
      'Remove non-asyncapi macros (sequence, graph, embed); keep asyncapi macros + the OpenAPI macro',
    )
    expect(desc).toContain(
      'Remove globalSettings + globalPage + contentBylineItem (asyncapi uses spacePage only)',
    )
    expect(desc).toContain(
      "Allow 'unsafe-eval' in CSP (required by AsyncAPI Studio runtime schema compilation)",
    )
    // asyncapi keeps the Connect lifecycle module — it still serves legacy
    // Connect (my-api / AsyncAPI-Conf-V2) installs.
    expect(desc).not.toContain('Remove Connect lifecycle module (connectModules)')
    expect(desc).toContain('Remove Lite snapshot and Diagramly demo schedules from AsyncAPI')
    expect(desc).toContain('Remove Lite remote-storage declaration from AsyncAPI')

    const yq = getManifestEditYqArgs('asyncapi').map((x) => x.expr)
    expect(yq).not.toContain('del(.connectModules)')
    // Broader regex than zenuml-asyncapi-macro on its own — keeps the
    // regular asyncapi macro, the embed asyncapi macro, AND the OpenAPI
    // macro (AsyncAPI + OpenAPI are sibling API-spec formats).
    expect(yq).toContain(
      'del(.modules.macro[] | select(.key | test("zenuml-asyncapi|zenuml-openapi-macro") | not))',
    )
    // asyncapi keeps confluence:spacePage intact (its "My API Documents"
    // entry) but strips confluence:globalPage entirely.
    expect(yq).toContain(
      'del(.modules["confluence:globalSettings"]) | del(.modules["confluence:globalPage"]) | del(.modules["confluence:contentBylineItem"])',
    )
    expect(yq).toContain('.permissions.content.scripts = ["unsafe-eval"]')
    expect(yq.join(' ')).toContain('macroCountSnapshotScheduled')
  })
})
