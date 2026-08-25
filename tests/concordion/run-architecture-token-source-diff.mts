import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ArchitectureTokenSourceDiffFixture } from './architecture-token-source-diff.fixture.mts'

const concordionCore = process.env.CONCORDION_CORE
  ?? '/Users/pengxiao/workspaces/zenuml/concordion/packages/core'
const sourcePath = resolve(process.cwd(), 'tests/concordion/architecture-token-source-diff.html')
const reportPath = resolve(process.cwd(), '.tmp/concordion/architecture-token-source-diff.html')

const reportCss = `
  :root { color: #172b4d; background: #f7f8fa; font-family: ui-sans-serif, system-ui, sans-serif; }
  body { max-width: 1280px; margin: 2rem auto; padding: 0 1rem; line-height: 1.45; }
  table { width: 100%; border-collapse: collapse; background: #fff; box-shadow: 0 1px 2px rgb(9 30 66 / 0.12); margin-bottom: 1.5rem; }
  th, td { border: 1px solid #dfe1e6; padding: 0.55rem 0.7rem; text-align: left; vertical-align: top; }
  th { background: #f4f5f7; font-weight: 650; }
  tr:nth-child(even) { background: #fafbfc; }
  code { background: #f1f2f4; border-radius: 3px; padding: 0.1rem 0.25rem; }
  pre { margin: 0; overflow-x: auto; white-space: pre-wrap; }
  .fixture-key { display: none; }
  [data-concordion-result="success"], .concordion-success { color: #0f6b3a; background: #dcfce7; font-weight: 650; }
  [data-concordion-result="failure"], .concordion-failure { color: #b42318; background: #fee4e2; font-weight: 650; }
  [data-concordion-result="exception"], .concordion-exception { color: #5925dc; background: #f4f3ff; font-weight: 650; }
`

function applyReportStyles(html: string): string {
  if (!html.includes('</head>')) throw new Error('Concordion report has no </head> for report styles')
  return html.replace('</head>', `<style data-concordion-source-diff-styles>${reportCss}</style></head>`)
}

function decorateVisibleResultCells(html: string): string {
  return html.replace(/<tr\b[\s\S]*?<\/tr>/g, (row) => {
    const status = row.match(/data-concordion-result="(success|failure|exception)"/)?.[1]
    if (!status) return row
    return row.replace(
      '<td class="relocation-result">',
      `<td class="relocation-result concordion-${status} ${status}" data-concordion-result="${status}">`,
    )
  })
}

function verifyReaderFacingDocument(html: string): void {
  const whitespaceNormalized = html.replace(/\s+/g, ' ')
  for (const phrase of [
    'Stage 1 relocation evidence',
    'relocation evidence only',
    'never confirms logical identity',
    '<th>Before source</th>',
    '<th>After source</th>',
    '<th>Saved locator</th>',
    '<th>Relocation evidence</th>',
    '<th>Result</th>',
    'bytes 13–26',
    'bytes 22–35',
    'confidence <code>1.0</code>',
    'locator_intersects_change',
    'invalid_old_locator_span',
    'empty_old_locator_span',
    'duplicate_locator_id',
    '<pre><code>flowchart TD',
    'data-concordion-source-diff-styles',
    'background: #dcfce7',
    '<td class="relocation-result concordion-success success" data-concordion-result="success">',
  ]) {
    if (!whitespaceNormalized.includes(phrase)) {
      throw new Error(`Rendered report is missing reader-facing content: ${phrase}`)
    }
  }

  const visibleSuccesses = html.match(/<td class="relocation-result concordion-success success" data-concordion-result="success">/g) ?? []
  if (visibleSuccesses.length !== 5) {
    throw new Error(`Rendered report should have five visibly successful Result cells, found ${visibleSuccesses.length}`)
  }
}

const { runSpecification } = await import(
  pathToFileURL(resolve(concordionCore, 'dist/index.js')).href,
)
const source = await readFile(sourcePath, 'utf8')
await mkdir(resolve(process.cwd(), '.tmp/concordion'), { recursive: true })

const result = await runSpecification({
  source,
  fixture: new ArchitectureTokenSourceDiffFixture(),
  output: {
    path: reportPath,
    async write(resource: { path: string; content: string | Uint8Array }) {
      await writeFile(resource.path, applyReportStyles(decorateVisibleResultCells(String(resource.content))))
    },
  },
})
verifyReaderFacingDocument(await readFile(reportPath, 'utf8'))

console.log(`Concordion Architecture Tokens source-diff report: ${reportPath}`)
console.log(`Summary: ${JSON.stringify(result.summary)}`)

if (result.summary.failures + result.summary.exceptions > 0) {
  process.exitCode = 1
}
