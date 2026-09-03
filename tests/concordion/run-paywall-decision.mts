import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PaywallDecisionFixture } from './paywall-decision.fixture.mts'

const concordionCore = process.env.CONCORDION_CORE
  ?? '/Users/pengxiao/workspaces/zenuml/concordion/packages/core'
const sourcePath = resolve(process.cwd(), 'tests/concordion/paywall-decision.html')
const reportPath = resolve(process.cwd(), '.tmp/concordion/paywall-decision.html')
const stateDemoPath = resolve(process.cwd(), '.tmp/concordion/paywall-report-states-demo.html')

// Deliberately local to this trial runner: these presentation rules do not
// modify Concordion core or any Paywall production surface.
const trialReportCss = `
  :root { color: #172b4d; background: #f7f8fa; font-family: ui-sans-serif, system-ui, sans-serif; }
  body { max-width: 1120px; margin: 2rem auto; padding: 0 1rem; line-height: 1.45; }
  table { width: 100%; border-collapse: collapse; background: #fff; box-shadow: 0 1px 2px rgb(9 30 66 / 0.12); }
  th, td { border: 1px solid #dfe1e6; padding: 0.55rem 0.7rem; text-align: left; vertical-align: top; }
  th { background: #f4f5f7; font-weight: 650; }
  tr:nth-child(even) { background: #fafbfc; }
  [data-concordion-result="success"], .concordion-success { color: #0f6b3a; background: #dcfce7; font-weight: 650; }
  [data-concordion-result="failure"], .concordion-failure { color: #b42318; background: #fee4e2; font-weight: 650; }
  [data-concordion-result="exception"], .concordion-exception { color: #5925dc; background: #f4f3ff; font-weight: 650; }
`

function applyTrialReportStyles(html: string): string {
  if (!html.includes('</head>')) throw new Error('Concordion report has no </head> for trial styles')
  return html.replace('</head>', `<style data-concordion-trial-styles>${trialReportCss}</style></head>`)
}

function verifyTrialReportStyles(html: string): void {
  for (const selector of [
    '[data-concordion-result="success"]',
    '[data-concordion-result="failure"]',
    '[data-concordion-result="exception"]',
  ]) {
    if (!html.includes(selector)) throw new Error(`Trial report CSS is missing ${selector}`)
  }
}

const stateDemoSource = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Concordion result states</title></head><body>
  <h1>Concordion result-state styling demo</h1>
  <table>
    <tr><th>State</th><th>Rendered result</th></tr>
    <tr><td>Failure</td><td data-concordion-assert-true="returnsFalse()">true</td></tr>
    <tr><td>Exception</td><td data-concordion-assert-true="throwsError()">true</td></tr>
  </table>
</body></html>`

const { runSpecification } = await import(
  pathToFileURL(resolve(concordionCore, 'dist/index.js')).href,
)
const source = await readFile(sourcePath, 'utf8')
await mkdir(resolve(process.cwd(), '.tmp/concordion'), { recursive: true })

const result = await runSpecification({
  source,
  fixture: new PaywallDecisionFixture(),
  output: {
    path: reportPath,
    async write(resource: { path: string; content: string | Uint8Array }) {
      await writeFile(resource.path, applyTrialReportStyles(String(resource.content)))
    },
  },
})

const stateDemo = await runSpecification({
  source: stateDemoSource,
  fixture: {
    returnsFalse: () => false,
    throwsError: () => { throw new Error('Demonstration exception') },
  },
})
const styledStateDemo = applyTrialReportStyles(stateDemo.html)
verifyTrialReportStyles(styledStateDemo)
if (stateDemo.summary.failures !== 1 || stateDemo.summary.exceptions !== 1) {
  throw new Error(`Unexpected state-demo summary: ${JSON.stringify(stateDemo.summary)}`)
}
await writeFile(stateDemoPath, styledStateDemo)

console.log(`Concordion Paywall report: ${reportPath}`)
console.log(`Summary: ${JSON.stringify(result.summary)}`)
console.log(`Concordion result-state demo: ${stateDemoPath}`)

if (result.summary.failures + result.summary.exceptions > 0) {
  process.exitCode = 1
}
