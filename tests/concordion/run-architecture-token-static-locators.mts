import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseHTML } from 'linkedom'

const concordionCore = process.env.CONCORDION_CORE
  ?? '/Users/pengxiao/workspaces/zenuml/concordion/packages/core'
const sourcePath = resolve(process.cwd(), 'tests/concordion/architecture-token-static-locators.html')
const reportPath = resolve(process.cwd(), '.tmp/concordion/architecture-token-static-locators.html')

const { window, document } = parseHTML('<!doctype html><html><head></head><body></body></html>')
const globals = globalThis as unknown as Record<string, unknown>
globals.window = window
globals.document = document
if (!('navigator' in globalThis)) globals.navigator = window.navigator
globals.DOMParser = window.DOMParser

const { ArchitectureTokenStaticLocatorsFixture } = await import(
  './architecture-token-static-locators.fixture.mts',
)

const reportCss = `
  :root { color: #172b4d; background: #f7f8fa; font-family: ui-sans-serif, system-ui, sans-serif; }
  body { max-width: 1240px; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; }
  h1 { color: #0c2340; letter-spacing: -0.02em; }
  h2 { margin-top: 2rem; color: #123b5d; }
  h3 { margin: 0 0 0.35rem; color: #155e75; }
  .eyebrow { color: #0f7490; font-size: 0.78rem; font-weight: 750; letter-spacing: 0.12em; text-transform: uppercase; }
  .lede { max-width: 72rem; font-size: 1.1rem; color: #334e68; }
  .scope { padding: 1rem 1.2rem; border: 1px solid #b8c7d9; border-radius: 10px; background: linear-gradient(135deg, #eef7fb, #f8fbfd); }
  .scope-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1rem; }
  .scope-grid > div { padding: 0.75rem; border-radius: 7px; background: rgb(255 255 255 / 0.75); }
  .stage-order { padding-left: 1.6rem; }
  .stage-order li { margin: 0.45rem 0; }
  .single-revision-note { padding: 0.8rem 1rem; border-left: 4px solid #0f7490; background: #e6f6f8; color: #164e63; }
  table { width: 100%; border-collapse: collapse; background: #fff; box-shadow: 0 1px 2px rgb(9 30 66 / 0.12); }
  th, td { border: 1px solid #d7e0ea; padding: 0.65rem 0.75rem; text-align: left; vertical-align: top; }
  th { background: #edf2f7; color: #243b53; font-weight: 700; }
  tr:nth-child(even) { background: #fbfdff; }
  code { background: #eef2f6; border-radius: 4px; padding: 0.1rem 0.28rem; }
  pre { margin: 0; overflow-x: auto; white-space: pre-wrap; }
  .fixture-key { display: none; }
  details { margin-top: 0.5rem; color: #486581; }
  summary { cursor: pointer; font-size: 0.92em; }
  [data-concordion-result="success"], .concordion-success { color: #0f6b3a; background: #dcfce7; font-weight: 650; }
  [data-concordion-result="failure"], .concordion-failure { color: #b42318; background: #fee4e2; font-weight: 650; }
  [data-concordion-result="exception"], .concordion-exception { color: #5925dc; background: #f4f3ff; font-weight: 650; }
  @media (max-width: 900px) { .scope-grid { grid-template-columns: 1fr; } table { font-size: 0.92rem; } }
`

function applyReportStyles(html: string): string {
  if (!html.includes('</head>')) throw new Error('Concordion report has no </head> for report styles')
  return html.replace('</head>', `<style data-concordion-static-locator-styles>${reportCss}</style></head>`)
}

function decorateVisibleResultCells(html: string): string {
  return html.replace(/<tr\b[\s\S]*?<\/tr>/g, (row) => {
    const status = row.match(/data-concordion-result="(success|failure|exception)"/)?.[1]
    if (!status) return row
    return row.replace(
      '<td class="locator-result">',
      `<td class="locator-result concordion-${status} ${status}" data-concordion-result="${status}">`,
    )
  })
}

function verifyReaderFacingExplanation(html: string): void {
  for (const phrase of [
    'Static syntax-based locator correctness',
    'Official Mermaid syntax validation',
    'Flowchart source parsing',
    'Canonical elements versus source occurrences',
    'Primary locator plus occurrences',
    'UTF-8 byte-span round trip',
    'Static fingerprint facts',
    'How to read the tables',
    'Valid source and stored locator',
    'Multiple occurrences and UTF-8',
    'Rejected and unsafe cases',
    'Locator data model',
    'Fail-closed boundary',
    'Saved locator',
    'Logical node',
    'Primary role',
    'UTF-8 byte range',
    'Round-tripped fragment',
    'Every locator round-trips exact UTF-8 source bytes',
    'Invalid Mermaid stops before any locator is emitted',
    'Labels, edge text, and subgraph titles stay outside node locators',
    'A style reference is not silently converted into a node',
    'A tampered or non-syntax-derived span fails closed',
    'single-revision specification',
    'No revision comparison',
    'binding transfer',
    'data-concordion-static-locator-styles',
    'background: #dcfce7',
    'white-space: pre-wrap',
    'overflow-x: auto',
  ]) {
    if (!html.includes(phrase)) throw new Error(`Rendered report is missing reader-facing explanation: ${phrase}`)
  }

  const visibleSuccesses = html.match(/<td class="locator-result concordion-success success" data-concordion-result="success">/g) ?? []
  if (visibleSuccesses.length !== 6) {
    throw new Error(`Rendered report should have six visibly successful product results, found ${visibleSuccesses.length}`)
  }

  const savedLocatorHeaders = html.match(/>Saved locator<\/th>/g) ?? []
  if (savedLocatorHeaders.length !== 3) {
    throw new Error(`Rendered report should have three focused Saved locator columns, found ${savedLocatorHeaders.length}`)
  }

  const sourceFragmentBlocks = html.match(/class="source-fragment"/g) ?? []
  if (sourceFragmentBlocks.length < 10) {
    throw new Error(`Rendered report should preserve source fragments as block code, found ${sourceFragmentBlocks.length} blocks`)
  }
}

const { runSpecification } = await import(
  pathToFileURL(resolve(concordionCore, 'dist/index.js')).href,
)
const source = await readFile(sourcePath, 'utf8')
await mkdir(resolve(process.cwd(), '.tmp/concordion'), { recursive: true })

const result = await runSpecification({
  source,
  fixture: new ArchitectureTokenStaticLocatorsFixture(),
  output: {
    path: reportPath,
    async write(resource: { path: string; content: string | Uint8Array }) {
      await writeFile(resource.path, applyReportStyles(decorateVisibleResultCells(String(resource.content))))
    },
  },
})
verifyReaderFacingExplanation(await readFile(reportPath, 'utf8'))

console.log(`Concordion Architecture Tokens static-locator report: ${reportPath}`)
console.log(`Summary: ${JSON.stringify(result.summary)}`)

if (result.summary.failures + result.summary.exceptions > 0) {
  process.exitCode = 1
}
