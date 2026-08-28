import fs from 'node:fs'

import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

import {
  getManifestEditDescriptions,
  getManifestEditYqArgs,
} from '../../scripts/forge-wizard.mjs'

describe('forge-wizard manifest preview helpers', () => {
  it('keeps PlantUML egress client-only', () => {
    const manifest = load(fs.readFileSync('manifest.yml', 'utf8')) as any
    expect(manifest.permissions.external.fetch.backend).not.toContain(
      'https://www.plantuml.com',
    )
    expect(manifest.permissions.external.fetch.client).toContain(
      'https://www.plantuml.com',
    )
  })

  it('base manifest defines the Lite daily snapshot with backend timeout and EUD storage', () => {
    const manifest = load(fs.readFileSync('manifest.yml', 'utf8')) as any
    expect(manifest.modules.scheduledTrigger).toContainEqual({
      key: 'lite-macro-count-daily',
      function: 'macroCountSnapshotFn',
      interval: 'day',
    })
    expect(manifest.modules.function).toContainEqual({
      key: 'macroCountSnapshotFn',
      handler: 'macro-count-snapshot.scheduledHandler',
      timeoutSeconds: 900,
    })
    const connect = manifest.remotes.find((remote: any) => remote.key === 'connect')
    expect(connect.operations).toContain('storage')
    expect(connect.storage).toEqual({ inScopeEUD: true })
  })

  it('all manifest-generation paths retain the shared remote EUD declaration', () => {
    for (const variant of ['lite', 'full', 'diagramly', 'asyncapi'] as const) {
      const yq = getManifestEditYqArgs(variant).map((edit) => edit.expr).join('\n')
      expect(yq).not.toContain('select(. == "storage")')
      expect(yq).not.toContain('select(.key == "connect").storage')
    }

    for (const workflow of [
      '.github/workflows/staging-deploy.yml',
      '.github/workflows/release.yml',
    ]) {
      const source = fs.readFileSync(workflow, 'utf8')
      expect(source).not.toContain('select(. == "storage")')
      expect(source).not.toContain('select(.key == "connect").storage')
    }
  })

  it('lite strips licensing, contentBylineItem, and asyncapi bits (but keeps the AsyncAPI macro)', () => {
    const desc = getManifestEditDescriptions('lite')
    expect(desc).toContain('Remove licensing (lite is free)')
    expect(desc).toContain('Remove zenuml-byline-aiaide from confluence:contentBylineItem (keep zenuml-byline-newuser)')
    // ADR-0005 Option A: Lite ships zenuml-asyncapi-macro (content stored
    // under the shared zenuml-content-sequence type) and strips ONLY the
    // embed macro, which references async-api-doc documents.
    expect(desc).toContain(
      'Remove asyncapi embed macro (zenuml-asyncapi-embed-macro; Lite keeps zenuml-asyncapi-macro per ADR-0005)',
    )
    expect(desc).toContain('Remove asyncapi custom content (async-api-doc)')
    expect(desc).toContain('Remove asyncapi spacePage (zenuml-asyncapi-dashboard-page)')
    expect(desc).toContain(
      "Allow 'unsafe-eval' in CSP (required by AsyncAPI Studio runtime schema compilation)",
    )
    expect(desc).toContain('Remove Connect lifecycle module (connectModules)')
    expect(desc).toContain('Remove Diagramly demo-page modules (Lite keeps only macro snapshot schedule)')

    const yq = getManifestEditYqArgs('lite').map((x) => x.expr)
    expect(yq).toContain('del(.app.licensing)')
    // Lite ships TWO byline entries — the activation nudge and the diagram
    // index — and drops only the Diagramly-branded one. A whole-module delete
    // here would take both of them with it.
    expect(yq).toContain('del(.modules["confluence:contentBylineItem"][] | select(.key == "zenuml-byline-aiaide"))')
    expect(yq).not.toContain('del(.modules["confluence:contentBylineItem"])')
    // The broad test("zenuml-asyncapi") filter would take the page macro too —
    // Lite must use the exact embed-macro key.
    expect(yq).toContain(
      'del(.modules.macro[] | select(.key == "zenuml-asyncapi-embed-macro"))',
    )
    expect(yq).not.toContain(
      'del(.modules.macro[] | select(.key | test("zenuml-asyncapi")))',
    )
    expect(yq).toContain(
      'del(.modules["confluence:customContent"][] | select(.key | test("async-api-doc")))',
    )
    expect(yq).toContain('del(.modules["confluence:spacePage"])')
    expect(yq).toContain('.permissions.content.scripts = ["unsafe-eval"]')
    expect(yq).toContain('del(.connectModules)')
    expect(yq.join(' ')).not.toContain('macroCountSnapshotFn')
  })

  it('only Lite keeps the byline paste-to-create matchers', () => {
    // The /new/<type> and /d/<type>/*/* patterns are minted only by the Lite
    // byline. Any other variant carrying them races Lite for the same pasted
    // URL on a both-installed site, and app-scoped custom content makes the
    // wrong winner a permanently broken macro — so every non-Lite variant
    // must strip them, and Lite must not.
    const STRIP = 'Remove byline paste-to-create matchers (Lite-only byline mints those links)'
    expect(getManifestEditDescriptions('lite')).not.toContain(STRIP)
    for (const variant of ['full', 'diagramly', 'asyncapi'] as const) {
      expect(getManifestEditDescriptions(variant), variant).toContain(STRIP)
      const expr = getManifestEditYqArgs(variant)
        .map((x: { expr: string }) => x.expr)
        .find((e: string) => e.includes('autoConvert.matchers'))
      // `[.]` not `\.`: a backslash escape would be eaten by the JS string
      // literal and silently widen the regex.
      expect(expr, variant).toContain('test("zenuml[.]com/(new|d)/(sequence|mermaid|plantuml|openapi|graph)")')
      // The follow-up clause must drop only EMPTIED autoConvert blocks — the
      // embed macro's 3-segment matchers survive the first del and keep theirs.
      expect(expr, variant).toContain('length == 0) | .autoConvert)')
    }
  })

  it('full strips asyncapi bits and the Connect lifecycle module', () => {
    // Full is the "base" variant — it shares all the ZenUML/Mermaid/Graph/
    // OpenAPI/Embed macros with the base manifest, and only needs to strip
    // the AsyncAPI bits (macros + custom content + spacePage) which live in
    // the base manifest so the asyncapi variant can keep them, plus the
    // Connect lifecycle module (connectModules) — also asyncapi-only.
    const desc = getManifestEditDescriptions('full')
    expect(desc).toContain(
      'Remove zenuml-byline-aiaide and zenuml-byline-diagrams from confluence:contentBylineItem (keep zenuml-byline-newuser)',
    )
    expect(desc).toContain('Remove Lite snapshot and Diagramly demo schedules from Full')
    // Full is the only variant that drops TWO byline entries: aiaide is
    // Diagramly-branded and diagrams is the Lite index, leaving just the
    // activation nudge. The module itself must survive, or newuser goes too.
    // The strip normalizes byline-diagrams' displayConditions (dropping the
    // Lite-only `not: zenuml-full-active` leg) in the same expression before
    // deleting it — a no-op today that makes a future un-strip safe.
    const fullYq = getManifestEditYqArgs('full').map((x: { expr: string }) => x.expr)
    expect(fullYq).toContain(
      '(.modules["confluence:contentBylineItem"][] | select(.key == "zenuml-byline-diagrams") | .displayConditions) |= {"entityPropertyEqualTo": .and.entityPropertyEqualTo} | ' +
        'del(.modules["confluence:contentBylineItem"][] | select(.key == "zenuml-byline-aiaide" or .key == "zenuml-byline-diagrams"))',
    )
    expect(fullYq).not.toContain('del(.modules["confluence:contentBylineItem"])')
    expect(getManifestEditYqArgs('full').map((x) => x.expr)).toContain(
      'del(.connectModules)',
    )
    expect(getManifestEditYqArgs('full').map((x) => x.expr).join(' '))
      .toContain('macroCountSnapshotFn')
  })

  it('diagramly strips global UI modules and asyncapi bits, but KEEPS the embed macro', () => {
    // Diagramly ships the embed macro (task 6, deeplink productization,
    // commit c539e1f7) — this test used to assert the opposite (a
    // 'Remove embed macro (zenuml-embed-macro)' edit) and went stale the
    // moment that commit landed without updating it. CI's parallel manifest
    // edits (.github/workflows/release.yml + staging-deploy.yml) must agree
    // with this wizard — see the comment on diagramly's manifestEdits array
    // in scripts/forge-wizard.mjs.
    const desc = getManifestEditDescriptions('diagramly')
    expect(desc).toContain('Remove globalSettings + globalPage + spacePage')
    expect(desc).not.toContain('Remove embed macro (zenuml-embed-macro)')
    expect(desc).toContain(
      'Remove asyncapi macros (zenuml-asyncapi-macro + zenuml-asyncapi-embed-macro)',
    )
    expect(desc).toContain('Remove asyncapi custom content (async-api-doc)')
    expect(desc).toContain('Remove Connect lifecycle module (connectModules)')
    expect(desc).toContain('Remove the Lite diagrams byline entry (Diagramly keeps Aide)')
    expect(desc).toContain('Remove Lite macro snapshot schedule from Diagramly')
    // Diagramly's globalSettings+globalPage+spacePage strip removes both
    // the ZenUML dashboard and the asyncapi spacePage in a single edit.

    const yq = getManifestEditYqArgs('diagramly').map((x) => x.expr)
    expect(yq).toContain(
      'del(.modules["confluence:globalSettings"]) | del(.modules["confluence:globalPage"]) | del(.modules["confluence:spacePage"])',
    )
    expect(yq).not.toContain(
      'del(.modules.macro[] | select(.key | test("zenuml-embed-macro")))',
    )
    expect(yq).toContain(
      'del(.modules.macro[] | select(.key | test("zenuml-asyncapi")))',
    )
    expect(yq).toContain('del(.connectModules)')
    expect(yq.join(' ')).toContain('macroCountSnapshotFn')
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
      'Remove globalSettings + globalPage + contentBylineItem + homepageFeed (asyncapi uses spacePage only)',
    )
    expect(desc).toContain(
      "Allow 'unsafe-eval' in CSP (required by AsyncAPI Studio runtime schema compilation)",
    )
    // asyncapi keeps the Connect lifecycle module — it still serves legacy
    // Connect (my-api / AsyncAPI-Conf-V2) installs.
    expect(desc).not.toContain('Remove Connect lifecycle module (connectModules)')
    expect(desc).toContain('Remove Lite snapshot and Diagramly demo schedules from AsyncAPI')

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
      'del(.modules["confluence:globalSettings"]) | del(.modules["confluence:globalPage"]) | del(.modules["confluence:contentBylineItem"]) | del(.modules["confluence:homepageFeed"])',
    )
    expect(yq).toContain('.permissions.content.scripts = ["unsafe-eval"]')
    expect(yq.join(' ')).toContain('macroCountSnapshotFn')
  })
})
