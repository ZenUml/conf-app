// Pure prompt builder for the macro-viewer "Copy for AI" action. No Vue, no
// Forge/Confluence imports — the UI layer (GenericViewer.vue) wires clipboard
// + analytics around this. Produces one plain-text payload: the diagram DSL
// in a fenced code block, plus (when available) the plain-text body of the
// page the diagram lives on, so pasting into an external AI chat carries
// enough context to answer questions about the diagram without the user
// re-explaining the page by hand.
//
// `job` (CopyForAiJob, default 'generic') selects which preamble paragraph
// opens the payload — the split button's primary segment vs. its five
// job-framed menu entries (explain / update / implement / audit / tests, see
// GenericViewer.vue). Every job shares the exact same DSL + page payload
// below the preamble: ## Diagram/## Page structure, fence escalation, byte
// counts, URL-omission, and the diagram-only fallback all stay identical —
// only jobIntroExtra/jobBody vary.
//
// `dslBytes` / `pageBytes` mirror the copy_for_ai_clicked analytics
// properties (src/utils/analytics/types.ts) — UTF-8 byte length, not JS
// string .length, so multibyte content (e.g. CJK) isn't undercounted.

export type CopyForAiDslLabel = 'ZenUML' | 'Mermaid' | 'PlantUML'
export type CopyForAiFenceLang = 'zenuml' | 'mermaid' | 'plantuml'

// The split button's five job-framed menu entries, plus 'generic' — the
// original one-click primary segment's wording. Only the preamble (the
// paragraph right after "Context from Confluence …") varies by job; the
// ## Diagram / ## Page structure, fence escalation, byte counts, and
// fallback rules below are identical for every job. See jobBody/jobIntroExtra.
export type CopyForAiJob = 'generic' | 'explain' | 'update' | 'implement' | 'audit' | 'tests'

export interface CopyForAiPage {
  title: string
  url: string
  text: string
}

export interface BuildCopyForAiPromptInput {
  dslLabel: CopyForAiDslLabel
  fenceLang: CopyForAiFenceLang
  diagramTitle: string
  dsl: string
  page?: CopyForAiPage
  job?: CopyForAiJob
}

export interface CopyForAiPrompt {
  text: string
  dslBytes: number
  pageBytes: number
}

const encoder = new TextEncoder()

function byteLength(s: string): number {
  return encoder.encode(s).length
}

// Markdown fence escaping: a fence must be strictly longer than the longest
// run of backticks the fenced content itself contains, or the content would
// close the fence early. Minimum 3 backticks — the standard fence length.
function fenceFor(dsl: string): string {
  const runs = dsl.match(/`+/g) || []
  const longestRun = runs.reduce((max, run) => Math.max(max, run.length), 0)
  return '`'.repeat(Math.max(3, longestRun + 1))
}

// Extra sentence appended to the intro line for jobs that frame the page as a
// spec/doc to work from, rather than freeform surrounding context. Only
// 'implement' and 'audit' have one; every other job's intro is just the base
// sentence. Kept even in the fallback (no-page) shape — the fallback rule
// only drops the "and the text of the page it lives on" phrase from the base
// sentence, per the per-job spec.
function jobIntroExtra(job: CopyForAiJob): string | undefined {
  switch (job) {
    case 'implement': return 'They specify a design to implement.'
    case 'audit': return 'They document how this system is supposed to work.'
    default: return undefined
  }
}

// The paragraph after the intro line — what to actually do with the diagram
// (and, when present, the page). 'generic' is the original one-click
// wording verbatim, including its internal newline before "complete
// updated" (preserved for byte-identity with the pre-split-button output);
// every other job's body is a single unbroken line.
function jobBody(job: CopyForAiJob, dslLabel: CopyForAiDslLabel): string {
  switch (job) {
    case 'explain':
      return `Help me understand this flow — I'll ask my questions next. If you ever propose changes to the diagram, return the complete updated ${dslLabel} source in a fenced code block so I can paste it back.`
    case 'update':
      return `I want to change this diagram. I'll describe the change next — apply it and return the complete updated ${dslLabel} source in a fenced code block so I can paste it back.`
    case 'implement':
      return `Treat them as the spec — I'll tell you what to build next. If you ever propose changes to the diagram, return the complete updated ${dslLabel} source in a fenced code block so I can paste it back.`
    case 'audit':
      return `Compare this documented flow against the actual code in this repository and list where they disagree. If the diagram should change, return the complete updated ${dslLabel} source in a fenced code block so I can paste it back.`
    case 'tests':
      return `Derive test cases from this flow — cover the happy path, branches, and failure modes. If you ever propose changes to the diagram, return the complete updated ${dslLabel} source in a fenced code block so I can paste it back.`
    case 'generic':
    default:
      return (
        `I'll ask my question next. If you ever propose changes to the diagram, return the\n` +
        `complete updated ${dslLabel} source in a fenced code block so I can paste it back.`
      )
  }
}

export function buildCopyForAiPrompt(input: BuildCopyForAiPromptInput): CopyForAiPrompt {
  const { dslLabel, fenceLang, diagramTitle, dsl, page, job = 'generic' } = input
  // A page with empty/whitespace-only text carries no usable context —
  // treat it the same as "no page" (fallback shape) rather than emitting an
  // empty ## Page section.
  const hasPage = !!page && page.text.trim() !== ''

  const introBase = hasPage
    ? `Context from Confluence — a ${dslLabel} diagram and the text of the page it lives on.`
    : `Context from Confluence — a ${dslLabel} diagram.`
  const introExtra = jobIntroExtra(job)
  const intro = introExtra ? `${introBase} ${introExtra}` : introBase
  const body = jobBody(job, dslLabel)

  const diagramHeading =
    diagramTitle && diagramTitle.trim() !== '' ? `## Diagram: ${diagramTitle}` : `## Diagram`

  const fence = fenceFor(dsl)
  const diagramSection = `${diagramHeading}\n\n${fence}${fenceLang}\n${dsl}\n${fence}`

  const sections = [`${intro}\n${body}`, diagramSection]
  if (hasPage) {
    // The URL is best-effort (GenericViewer.vue's resolveCopyForAiPage can
    // fetch title+text but fail to resolve a URL) — when it's empty/
    // whitespace, omit the URL line entirely rather than emit a blank one.
    const url = page!.url.trim()
    const pageBody = url ? `${url}\n\n${page!.text}` : `\n${page!.text}`
    sections.push(`## Page: ${page!.title}\n${pageBody}`)
  }

  return {
    text: sections.join('\n\n'),
    dslBytes: byteLength(dsl),
    pageBytes: hasPage ? byteLength(page!.text) : 0,
  }
}
