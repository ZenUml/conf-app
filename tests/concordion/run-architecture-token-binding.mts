import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ArchitectureTokenBindingFixture } from './architecture-token-binding.fixture.mts'

const concordionCore = process.env.CONCORDION_CORE
  ?? '/Users/pengxiao/workspaces/zenuml/concordion/packages/core'
const sourcePath = resolve(process.cwd(), 'tests/concordion/architecture-token-binding.html')
const reportPath = resolve(process.cwd(), '.tmp/concordion/architecture-token-binding.html')

// Local report presentation only; no production surface or Concordion package
// is changed. Green, red, and purple make pass, failed assertion, and fixture
// exception states easy to distinguish when the standalone file is opened.
const reportCss = `
  :root { color: #172b4d; background: #f7f8fa; font-family: ui-sans-serif, system-ui, sans-serif; }
  body { max-width: 1120px; margin: 2rem auto; padding: 0 1rem; line-height: 1.45; }
  table { width: 100%; border-collapse: collapse; background: #fff; box-shadow: 0 1px 2px rgb(9 30 66 / 0.12); }
  th, td { border: 1px solid #dfe1e6; padding: 0.55rem 0.7rem; text-align: left; vertical-align: top; }
  th { background: #f4f5f7; font-weight: 650; }
  tr:nth-child(even) { background: #fafbfc; }
  code { background: #f1f2f4; border-radius: 3px; padding: 0.1rem 0.25rem; }
  pre { margin: 0; overflow-x: auto; white-space: pre-wrap; }
  .fixture-key { display: none; }
  details { margin-top: 0.45rem; color: #44546f; }
  summary { cursor: pointer; font-size: 0.9em; }
  [data-concordion-result="success"], .concordion-success { color: #0f6b3a; background: #dcfce7; font-weight: 650; }
  [data-concordion-result="failure"], .concordion-failure { color: #b42318; background: #fee4e2; font-weight: 650; }
  [data-concordion-result="exception"], .concordion-exception { color: #5925dc; background: #f4f3ff; font-weight: 650; }
`

function applyReportStyles(html: string): string {
  if (!html.includes('</head>')) throw new Error('Concordion report has no </head> for report styles')
  return html.replace('</head>', `<style data-concordion-architecture-token-styles>${reportCss}</style></head>`)
}

function verifyReaderFacingExplanation(html: string): void {
  for (const phrase of [
    'A binding is to a logical node',
    'Move an unchanged Orders API node',
    'Delete and recreate a node with the same Mermaid ID',
    'Split one node into two nodes',
    'Merge two nodes into one node',
    'Remove a node without a replacement',
    'Use syntax this release does not support',
    'A node-label rename is not yet an automatic case',
    'Saved binding evidence',
    'Logical node: Orders API',
    'No source-diff relocation was recorded',
    'Before',
    'After',
    'Result',
  ]) {
    if (!html.includes(phrase)) throw new Error(`Rendered report is missing reader-facing explanation: ${phrase}`)
  }
}

const { runSpecification } = await import(
  pathToFileURL(resolve(concordionCore, 'dist/index.js')).href,
)
const source = await readFile(sourcePath, 'utf8')
await mkdir(resolve(process.cwd(), '.tmp/concordion'), { recursive: true })

const result = await runSpecification({
  source,
  fixture: new ArchitectureTokenBindingFixture(),
  output: {
    path: reportPath,
    async write(resource: { path: string; content: string | Uint8Array }) {
      await writeFile(resource.path, applyReportStyles(String(resource.content)))
    },
  },
})
verifyReaderFacingExplanation(result.html)

console.log(`Concordion Architecture Tokens report: ${reportPath}`)
console.log(`Summary: ${JSON.stringify(result.summary)}`)

if (result.summary.failures + result.summary.exceptions > 0) {
  process.exitCode = 1
}
