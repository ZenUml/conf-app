import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ArchitectureTokenNativeIdFixture } from './architecture-token-native-id.fixture.mts'

const concordionCore = process.env.CONCORDION_CORE
  ?? '/Users/pengxiao/workspaces/zenuml/concordion/packages/core'
const sourcePath = resolve(process.cwd(), 'tests/concordion/architecture-token-native-id.html')
const reportPath = resolve(process.cwd(), '.tmp/concordion/architecture-token-native-id.html')

const reportCss = `
  :root { color: #172b4d; background: #f7f8fa; font-family: ui-sans-serif, system-ui, sans-serif; }
  body { max-width: 1280px; margin: 2rem auto; padding: 0 1rem; line-height: 1.45; }
  .table-scroll { max-width: 100%; overflow-x: auto; margin-bottom: 1.5rem; }
  table { width: 100%; min-width: 1120px; border-collapse: collapse; background: #fff; box-shadow: 0 1px 2px rgb(9 30 66 / 0.12); margin-bottom: 0; }
  th, td { border: 1px solid #dfe1e6; padding: 0.55rem 0.7rem; text-align: left; vertical-align: top; }
  th { background: #f4f5f7; font-weight: 650; }
  tr:nth-child(even) { background: #fafbfc; }
  code { background: #f1f2f4; border-radius: 3px; padding: 0.1rem 0.25rem; }
  td > pre { min-width: 16rem; max-width: 24rem; }
  pre { margin: 0; overflow-x: auto; white-space: pre; }
  .fixture-key { display: none; }
  [data-concordion-result="success"], .concordion-success { color: #0f6b3a; background: #dcfce7; font-weight: 650; }
  [data-concordion-result="failure"], .concordion-failure { color: #b42318; background: #fee4e2; font-weight: 650; }
  [data-concordion-result="exception"], .concordion-exception { color: #5925dc; background: #f4f3ff; font-weight: 650; }
`

function applyReportStyles(html: string): string {
  if (!html.includes('</head>')) throw new Error('Concordion report has no </head> for report styles')
  return html.replace('</head>', `<style data-concordion-architecture-token-native-id-styles>${reportCss}</style></head>`)
}

function decorateVisibleResultCells(html: string): string {
  return html.replace(/<tr\b[\s\S]*?<\/tr>/g, (row) => {
    const status = row.match(/data-concordion-result="(success|failure|exception)"/)?.[1]
    if (!status) return row
    return row.replace(
      '<td class="native-id-result">',
      `<td class="native-id-result concordion-${status} ${status}" data-concordion-result="${status}">`,
    )
  })
}

function decorateResponsiveTables(html: string): string {
  return html
    .replace(/<table\b/g, '<div class="table-scroll"><table')
    .replace(/<\/table>/g, '</table></div>')
}

function verifyReaderFacingDocument(html: string): void {
  const whitespaceNormalized = html.replace(/\s+/g, ' ')
  for (const phrase of [
    'Stage 2 exact native-ID candidate assessment',
    'candidate assessment only',
    'never confirms',
    'retains an Architecture Token',
    'transfers a binding',
    '<th>Scenario</th>',
    '<th>Before source</th>',
    '<th>After source</th>',
    '<th>Native-ID evidence</th>',
    '<th>Source-diff evidence</th>',
    '<th>Result</th>',
    'Candidate:</strong> node <code>A</code>',
    'fingerprint_scoring',
    'locator_intersects_change',
    'no_exact_native_id_candidate',
    'duplicate_native_id_candidate',
    '<pre><code>flowchart TD',
    'data-concordion-architecture-token-native-id-styles',
    'background: #dcfce7',
    'white-space: pre;',
    'overflow-x: auto;',
    'min-width: 1120px',
    'class="table-scroll"',
    '<td class="native-id-result concordion-success success" data-concordion-result="success">',
  ]) {
    if (!whitespaceNormalized.includes(phrase)) {
      throw new Error(`Rendered native-ID report is missing reader-facing content: ${phrase}`)
    }
  }

  const visibleSuccesses = html.match(/<td class="native-id-result concordion-success success" data-concordion-result="success">/g) ?? []
  if (visibleSuccesses.length !== 4) {
    throw new Error(`Rendered native-ID report should have four visibly successful Result cells, found ${visibleSuccesses.length}`)
  }
}

const { runSpecification } = await import(
  pathToFileURL(resolve(concordionCore, 'dist/index.js')).href,
)
const source = await readFile(sourcePath, 'utf8')
await mkdir(resolve(process.cwd(), '.tmp/concordion'), { recursive: true })

const result = await runSpecification({
  source,
  fixture: new ArchitectureTokenNativeIdFixture(),
  output: {
    path: reportPath,
    async write(resource: { path: string; content: string | Uint8Array }) {
      const report = decorateResponsiveTables(decorateVisibleResultCells(String(resource.content)))
      await writeFile(resource.path, applyReportStyles(report))
    },
  },
})
verifyReaderFacingDocument(await readFile(reportPath, 'utf8'))

console.log(`Concordion Architecture Tokens native-ID report: ${reportPath}`)
console.log(`Summary: ${JSON.stringify(result.summary)}`)

if (result.summary.failures + result.summary.exceptions > 0) {
  process.exitCode = 1
}
