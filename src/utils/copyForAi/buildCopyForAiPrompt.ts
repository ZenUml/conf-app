// Pure prompt builder for the macro-viewer "Copy for AI" action. No Vue, no
// Forge/Confluence imports — the UI layer (a later task) wires clipboard +
// analytics around this. Produces one plain-text payload: the diagram DSL in
// a fenced code block, plus (when available) the plain-text body of the page
// the diagram lives on, so pasting into an external AI chat carries enough
// context to answer questions about the diagram without the user
// re-explaining the page by hand.
//
// `dslBytes` / `pageBytes` mirror the copy_for_ai_clicked analytics
// properties (src/utils/analytics/types.ts) — UTF-8 byte length, not JS
// string .length, so multibyte content (e.g. CJK) isn't undercounted.

export type CopyForAiDslLabel = 'ZenUML' | 'Mermaid' | 'PlantUML'
export type CopyForAiFenceLang = 'zenuml' | 'mermaid' | 'plantuml'

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

export function buildCopyForAiPrompt(input: BuildCopyForAiPromptInput): CopyForAiPrompt {
  const { dslLabel, fenceLang, diagramTitle, dsl, page } = input
  // A page with empty/whitespace-only text carries no usable context —
  // treat it the same as "no page" (fallback shape) rather than emitting an
  // empty ## Page section.
  const hasPage = !!page && page.text.trim() !== ''

  const intro = hasPage
    ? `Context from Confluence — a ${dslLabel} diagram and the text of the page it lives on.`
    : `Context from Confluence — a ${dslLabel} diagram.`
  const editBack =
    `I'll ask my question next. If you ever propose changes to the diagram, return the\n` +
    `complete updated ${dslLabel} source in a fenced code block so I can paste it back.`

  const diagramHeading =
    diagramTitle && diagramTitle.trim() !== '' ? `## Diagram: ${diagramTitle}` : `## Diagram`

  const fence = fenceFor(dsl)
  const diagramSection = `${diagramHeading}\n\n${fence}${fenceLang}\n${dsl}\n${fence}`

  const sections = [`${intro}\n${editBack}`, diagramSection]
  if (hasPage) {
    sections.push(`## Page: ${page!.title}\n${page!.url}\n\n${page!.text}`)
  }

  return {
    text: sections.join('\n\n'),
    dslBytes: byteLength(dsl),
    pageBytes: hasPage ? byteLength(page!.text) : 0,
  }
}
