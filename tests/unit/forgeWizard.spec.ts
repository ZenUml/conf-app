import fs from 'node:fs'

import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

import {
  getManifestEditDescriptions,
  getManifestEditYqArgs,
} from '../../scripts/forge-wizard.mjs'

import { DEEPLINK_TYPES, typedDeeplinkHostForProductType } from '../../src/utils/embedDeeplink'
import { bylineTileMacroTypes } from '../../src/utils/byline/pickerTypes'
import { unplacedPropertyKeyFor } from '../../src/utils/byline/unplacedProperty'

const VARIANTS = ['lite', 'full', 'diagramly', 'asyncapi'] as const

/** Whether a variant's manifest edits keep the `zenuml-byline-diagrams` entry.
 *  Deleting the entry ends in `select(.key == "zenuml-byline-diagrams"))`;
 *  Full and AsyncAPI only reach INTO it (`... | .displayConditions)`), which
 *  must not read as a strip. */
function keepsDiagramsByline(variant: string): boolean {
  return !getManifestEditYqArgs(variant).some(
    ({ expr }: { expr: string }) =>
      expr.includes('select(.key == "zenuml-byline-diagrams"))') ||
      /select\(\.key == "zenuml-byline-aiaide" or \.key == "zenuml-byline-diagrams"\)/.test(expr) ||
      expr.includes('del(.modules["confluence:contentBylineItem"])'),
  )
}

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

  it('allows anonymous access on every macro that allows unlicensed access', () => {
    const manifest = load(fs.readFileSync('manifest.yml', 'utf8')) as any
    const macros = manifest.modules.macro as any[]
    const expectedKeys = [
      '${SEQUENCE_MACRO_KEY}',
      'zenuml-openapi-macro${LITE_KEY_SUFFIX}',
      'zenuml-graph-macro${LITE_KEY_SUFFIX}',
      'zenuml-embed-macro${LITE_KEY_SUFFIX}',
    ]

    const unlicensedMacros = macros.filter((macro) =>
      macro.unlicensedAccess?.includes('unlicensed'),
    )
    expect(unlicensedMacros.map((macro) => macro.key)).toEqual(expectedKeys)
    for (const macro of unlicensedMacros) {
      expect(macro.unlicensedAccess, macro.key).toContain('anonymous')
    }
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

  // scripts/forge-wizard.mjs is the source of truth, but three workflows carry
  // hand-copied duplicates of its yq edits and have drifted before (#383/#460,
  // and deploy-whimet4.yml was missed when ADR-0005 landed). Pin the Lite
  // asyncapi edits across every workflow that deploys Lite, so the next drift
  // fails here instead of shipping a manifest nobody intended.
  describe('Lite asyncapi manifest edits are mirrored in every Lite-deploying workflow', () => {
    const LITE_WORKFLOWS = [
      '.github/workflows/release.yml',
      '.github/workflows/staging-deploy.yml',
      '.github/workflows/deploy-whimet4.yml',
    ]
    const BROAD_ASYNCAPI_STRIP =
      'del(.modules.macro[] | select(.key | test("zenuml-asyncapi")))'
    const liteYq = (): string[] =>
      getManifestEditYqArgs('lite').map((x: { expr: string }) => x.expr)

    it.each(LITE_WORKFLOWS)('%s carries the wizard\'s Lite asyncapi edits', (file: string) => {
      const yaml = fs.readFileSync(file, 'utf8')
      const yq = liteYq()
      const embedStrip = yq.find((e: string) => e.includes('zenuml-asyncapi-embed-macro'))
      const cspEdit = yq.find((e: string) => e.includes('unsafe-eval'))
      expect(embedStrip).toBeDefined()
      expect(cspEdit).toBeDefined()
      expect(yaml).toContain(embedStrip!)
      expect(yaml).toContain(cspEdit!)
    })

    // deploy-whimet4.yml deploys ONLY Lite, so unlike release.yml /
    // staging-deploy.yml it has no legitimate reason to carry the broad
    // filter — that filter would strip the page macro Lite is meant to ship.
    it('deploy-whimet4.yml never uses the broad asyncapi filter', () => {
      const yaml = fs.readFileSync('.github/workflows/deploy-whimet4.yml', 'utf8')
      expect(yaml).not.toContain(BROAD_ASYNCAPI_STRIP)
    })

    // Every macro Lite ships must carry ${LITE_KEY_SUFFIX} so its key resolves
    // to a `-lite` name, the way the CQL `macro in (...)` searches that key on
    // the bare macro name expect (src/lite-full-conversion.ts). The AsyncAPI
    // macro was added unsuffixed when ADR-0005 landed.
    it('every macro Lite keeps is templated with the Lite key suffix', () => {
      const manifest = load(fs.readFileSync('manifest.yml', 'utf8')) as any
      const liteStrips = getManifestEditYqArgs('lite')
        .map((x: { expr: string }) => x.expr)
        .filter((e: string) => e.includes('.modules.macro'))
      const strippedFromLite = (key: string) =>
        liteStrips.some((e: string) => e.includes(`"${key}"`))

      const kept = manifest.modules.macro
        .map((m: { key: string }) => m.key)
        .filter((key: string) => !strippedFromLite(key))
      expect(kept).toContain('zenuml-asyncapi-macro${LITE_KEY_SUFFIX}')
      for (const key of kept) {
        // ${SEQUENCE_MACRO_KEY} is substituted whole per variant, so it needs
        // no suffix of its own.
        if (key === '${SEQUENCE_MACRO_KEY}') continue
        expect(key).toContain('${LITE_KEY_SUFFIX}')
      }
    })

    // `pnpm build:lite` chains `build:studio`, which needs the submodule.
    it('every Lite-deploying workflow inits the asyncapi-studio submodule', () => {
      for (const file of LITE_WORKFLOWS) {
        expect(fs.readFileSync(file, 'utf8'))
          .toContain('git submodule update --init --depth 1 vendor/asyncapi-studio')
      }
    })
  })

  // The other half of the paste-to-place contract. buildDiagramDeeplink mints a
  // link for every type in DEEPLINK_TYPES; a type with no matching autoConvert
  // matcher in the manifest produces a link that pastes as inert text, so the
  // byline's post-create panel reports `linked` and hands the user a URL that
  // does nothing. The two lists have to move together, and only a test that
  // reads both can say so.
  it('every minted deeplink type has autoConvert matchers in the manifest', () => {
    const manifest = load(fs.readFileSync('manifest.yml', 'utf8')) as any
    const patterns: string[] = manifest.modules.macro.flatMap(
      (m: any) => (m.autoConvert?.matchers ?? []).map((x: any) => String(x.pattern)),
    )
    for (const type of DEEPLINK_TYPES) {
      expect(patterns, type).toContain(`https://confluence.zenuml.com/new/${type}`)
      expect(patterns, type).toContain(`https://confluence.zenuml.com/d/${type}/*/*`)
    }
  })

  it('ships the diagram-index byline in Lite, Full and AsyncAPI — not Diagramly', () => {
    expect(VARIANTS.filter(keepsDiagramsByline)).toEqual(['lite', 'full', 'asyncapi'])
  })

  // BylineDiagrams.vue offers the tiles `bylineTileMacroTypes` lists for the
  // build, on the strength of this: whatever variant keeps the byline keeps
  // every macro its tiles point at. A tile without its macro would NOT be dead
  // — forgeIndex reads `modal.diagramType === 'asyncapi'` but falls through to
  // the OpenAPI branch when its product gate fails, so the user would pick
  // AsyncAPI and get a swagger document filed under the wrong type.
  it('no variant keeps the byline panel without the macros its tiles create', () => {
    const MACRO_KEY_BY_TILE: Record<string, string> = {
      mermaid: '${SEQUENCE_MACRO_KEY}',
      sequence: '${SEQUENCE_MACRO_KEY}',
      graph: 'zenuml-graph-macro${LITE_KEY_SUFFIX}',
      openapi: 'zenuml-openapi-macro${LITE_KEY_SUFFIX}',
      asyncapi: 'zenuml-asyncapi-macro${LITE_KEY_SUFFIX}',
    }
    const manifest = load(fs.readFileSync('manifest.yml', 'utf8')) as any
    const baseMacroKeys: string[] = manifest.modules.macro.map((m: any) => m.key)
    // Sanity: the tile list is written against the base manifest, so a renamed
    // macro key must break here rather than silently pass the loop below.
    for (const key of Object.values(MACRO_KEY_BY_TILE)) expect(baseMacroKeys, key).toContain(key)

    for (const variant of VARIANTS) {
      if (!keepsDiagramsByline(variant)) continue
      const exprs = getManifestEditYqArgs(variant).map((x: { expr: string }) => x.expr)
      const TILE_MACRO_KEYS = bylineTileMacroTypes(variant).map(t => MACRO_KEY_BY_TILE[t])
      // `| not` inverts the selector into a KEEP-list (the asyncapi variant's
      // shape): a tile's macro survives only if the keep regex covers it.
      const keepPatterns = exprs
        .filter((e: string) => e.includes('.modules.macro') && e.includes('| not'))
        .flatMap((e: string) => Array.from(e.matchAll(/test\("([^"]+)"\) \| not/g)).map(m => m[1]))
      for (const key of TILE_MACRO_KEYS) {
        for (const p of keepPatterns) {
          expect(new RegExp(p).test(key), `${variant} keep-list /${p}/ drops ${key} but keeps the byline`).toBe(true)
        }
      }
      const macroStrips = exprs.filter(
        (e: string) => e.includes('.modules.macro') && !e.includes('| not') && !e.includes('autoConvert'),
      )
      // Two ways a macro gets stripped, and the second is the one that actually
      // regressed once: an exact `select(.key == "...")`, or a broad
      // `select(.key | test("..."))` whose regex happens to cover the key. The
      // broad `test("zenuml-asyncapi")` filter removed the very macro Lite is
      // meant to ship, so the regex form is evaluated, not just string-matched.
      const broadPatterns = macroStrips.flatMap(
        (e: string) => Array.from(e.matchAll(/test\("([^"]+)"\)/g)).map(m => m[1]),
      )
      for (const key of TILE_MACRO_KEYS) {
        const strippedByKey = macroStrips.some((e: string) => e.includes(`"${key}"`))
        expect(strippedByKey, `${variant} strips ${key} by key but keeps the byline`).toBe(false)
        const strippedByPattern = broadPatterns.find((p: string) => new RegExp(p).test(key))
        expect(strippedByPattern, `${variant} strips ${key} via /${strippedByPattern}/ but keeps the byline`)
          .toBeUndefined()
      }
    }
  })

  // Identical typed matchers in two installed apps race for one pasted URL,
  // and app-scoped custom content makes the wrong winner a permanently broken
  // macro. So every byline variant claims its typed links on its OWN host —
  // the host buildDiagramDeeplink mints on — and Diagramly, with no byline,
  // claims none.
  it('each byline variant claims typed paste links on its own minting host', () => {
    const exprFor = (variant: string) =>
      getManifestEditYqArgs(variant)
        .map((x: { expr: string }) => x.expr)
        .find((e: string) => e.includes('autoConvert.matchers'))

    // Lite: the source manifest's matchers, untouched, on the host it mints.
    expect(exprFor('lite')).toBeUndefined()
    expect(typedDeeplinkHostForProductType('lite')).toBe('confluence.zenuml.com')

    for (const variant of ['full', 'asyncapi'] as const) {
      const expr = exprFor(variant)
      expect(expr, variant).toBeDefined()
      // `[.]` not `\.`: a backslash escape would be eaten by the JS string
      // literal and silently widen the regex.
      expect(expr, variant).toContain('del(.modules.macro[].autoConvert.matchers[] | select(.pattern | test("zenuml[.]com/new/")))')
      expect(expr, variant).toContain(
        `sub("^https://confluence[.]zenuml[.]com/"; "https://${typedDeeplinkHostForProductType(variant)}/")`,
      )
    }
    const hosts = ['lite', 'full', 'asyncapi'].map(typedDeeplinkHostForProductType)
    expect(new Set(hosts).size, 'byline variants mint on distinct hosts').toBe(hosts.length)

    const diagramly = exprFor('diagramly')
    expect(diagramly).toContain('test("zenuml[.]com/(new|d)/(sequence|mermaid|plantuml|openapi|graph|asyncapi)")')
    // The follow-up clause must drop only EMPTIED autoConvert blocks — the
    // embed macro's 3-segment matchers survive the first del and keep theirs.
    expect(diagramly).toContain('length == 0) | .autoConvert)')
  })

  // The banner is gated on a content property only the diagram-index byline
  // writes, keyed per app because content properties are site-global.
  it('ships the unplaced banner wherever the byline writes its property, on that app\'s key', () => {
    const bannerExprs = (variant: string) =>
      getManifestEditYqArgs(variant)
        .map((x: { expr: string }) => x.expr)
        .filter((e: string) => e.includes('zenuml-unplaced-banner'))
    const STRIP = 'del(.modules["confluence:pageBanner"][] | select(.key == "zenuml-unplaced-banner"))'
    for (const variant of VARIANTS) {
      expect(bannerExprs(variant).includes(STRIP), variant).toBe(!keepsDiagramsByline(variant))
    }
    // Lite and Full get theirs from ${LITE_KEY_SUFFIX}; AsyncAPI's suffix is
    // empty, so its edit must name the key the code writes.
    const manifest = load(fs.readFileSync('manifest.yml', 'utf8')) as any
    const banner = manifest.modules['confluence:pageBanner'].find((m: any) => m.key === 'zenuml-unplaced-banner')
    const templated = banner.displayConditions.entityPropertyExists.propertyKey
    expect(templated.replace('${LITE_KEY_SUFFIX}', '-lite')).toBe(unplacedPropertyKeyFor('lite'))
    expect(templated.replace('${LITE_KEY_SUFFIX}', '')).toBe(unplacedPropertyKeyFor('full'))
    expect(bannerExprs('asyncapi')).toEqual([
      `(.modules["confluence:pageBanner"][] | select(.key == "zenuml-unplaced-banner") | .displayConditions.entityPropertyExists.propertyKey) = "${unplacedPropertyKeyFor('asyncapi')}"`,
    ])
    const keys = ['lite', 'full', 'asyncapi'].map(unplacedPropertyKeyFor)
    expect(new Set(keys).size).toBe(keys.length)
  })

  // The diagram-index entry's only display condition hides it where Full's
  // presence marker exists. That is Lite's handoff to Full; kept in Full it
  // would hide the byline on every space, and in AsyncAPI it would key off an
  // unrelated app.
  it('only Lite keeps the diagrams byline\'s Full-presence display condition', () => {
    const DROP =
      'del(.modules["confluence:contentBylineItem"][] | select(.key == "zenuml-byline-diagrams") | .displayConditions)'
    const drops = (v: string) => getManifestEditYqArgs(v).some(({ expr }: { expr: string }) => expr.includes(DROP))
    expect(drops('lite')).toBe(false)
    expect(drops('full')).toBe(true)
    expect(drops('asyncapi')).toBe(true)
  })

  it('full strips asyncapi bits and the Connect lifecycle module', () => {
    // Full is the "base" variant — it shares all the ZenUML/Mermaid/Graph/
    // OpenAPI/Embed macros with the base manifest, and only needs to strip
    // the AsyncAPI bits (macros + custom content + spacePage) which live in
    // the base manifest so the asyncapi variant can keep them, plus the
    // Connect lifecycle module (connectModules) — also asyncapi-only.
    const desc = getManifestEditDescriptions('full')
    expect(desc).toContain(
      'Remove zenuml-byline-aiaide from confluence:contentBylineItem (keep zenuml-byline-newuser + zenuml-byline-diagrams)',
    )
    expect(desc).toContain('Remove Lite snapshot and Diagramly demo schedules from Full')
    // Full drops only the Diagramly-branded aiaide entry. The module itself
    // must survive, or newuser and the diagram index go too.
    const fullYq = getManifestEditYqArgs('full').map((x: { expr: string }) => x.expr)
    expect(fullYq).toContain(
      'del(.modules["confluence:contentBylineItem"][] | select(.key == "zenuml-byline-aiaide"))',
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
    expect(desc).toContain('Remove globalSettings + globalPage + homepageFeed (asyncapi uses spacePage only)')
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
      'del(.modules["confluence:globalSettings"]) | del(.modules["confluence:globalPage"]) | del(.modules["confluence:homepageFeed"])',
    )
    // The byline module survives with only the diagram index in it.
    expect(yq).toContain(
      'del(.modules["confluence:contentBylineItem"][] | select(.key == "zenuml-byline-aiaide" or .key == "zenuml-byline-newuser")) | del(.modules["confluence:contentBylineItem"][] | select(.key == "zenuml-byline-diagrams") | .displayConditions)',
    )
    expect(yq).not.toContain('del(.modules["confluence:contentBylineItem"])')
    expect(yq).toContain('.permissions.content.scripts = ["unsafe-eval"]')
    expect(yq.join(' ')).toContain('macroCountSnapshotFn')
  })
})
