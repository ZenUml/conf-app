import { describe, it, expect } from 'vitest'
import { buildCopyForAiPrompt } from './buildCopyForAiPrompt'

describe('buildCopyForAiPrompt', () => {
  it('builds the full shape (diagram + page) exactly', () => {
    const result = buildCopyForAiPrompt({
      dslLabel: 'ZenUML',
      fenceLang: 'zenuml',
      diagramTitle: 'Checkout flow',
      dsl: 'A->B: hi',
      page: { title: 'Checkout design', url: 'https://example.atlassian.net/wiki/x', text: 'Some page body text.' },
    })

    expect(result.text).toBe(
      "Context from Confluence — a ZenUML diagram and the text of the page it lives on.\n" +
      "I'll ask my question next. If you ever propose changes to the diagram, return the\n" +
      "complete updated ZenUML source in a fenced code block so I can paste it back.\n" +
      "\n" +
      "## Diagram: Checkout flow\n" +
      "\n" +
      "```zenuml\n" +
      "A->B: hi\n" +
      "```\n" +
      "\n" +
      "## Page: Checkout design\n" +
      "https://example.atlassian.net/wiki/x\n" +
      "\n" +
      "Some page body text.",
    )
  })

  it('builds the fallback shape (no page): drops the page phrase and omits ## Page entirely', () => {
    const result = buildCopyForAiPrompt({
      dslLabel: 'Mermaid',
      fenceLang: 'mermaid',
      diagramTitle: 'Onboarding',
      dsl: 'graph TD; A-->B',
    })

    expect(result.text).toBe(
      "Context from Confluence — a Mermaid diagram.\n" +
      "I'll ask my question next. If you ever propose changes to the diagram, return the\n" +
      "complete updated Mermaid source in a fenced code block so I can paste it back.\n" +
      "\n" +
      "## Diagram: Onboarding\n" +
      "\n" +
      "```mermaid\n" +
      "graph TD; A-->B\n" +
      "```",
    )
    expect(result.text).not.toContain('## Page')
    expect(result.pageBytes).toBe(0)
  })

  it('keeps the edit-back instruction in both the full and fallback shapes', () => {
    const editBack =
      "I'll ask my question next. If you ever propose changes to the diagram, return the\n" +
      'complete updated PlantUML source in a fenced code block so I can paste it back.'

    const withPage = buildCopyForAiPrompt({
      dslLabel: 'PlantUML',
      fenceLang: 'plantuml',
      diagramTitle: 'T',
      dsl: '@startuml\n@enduml',
      page: { title: 'P', url: 'https://x', text: 'body' },
    })
    const withoutPage = buildCopyForAiPrompt({
      dslLabel: 'PlantUML',
      fenceLang: 'plantuml',
      diagramTitle: 'T',
      dsl: '@startuml\n@enduml',
    })

    expect(withPage.text).toContain(editBack)
    expect(withoutPage.text).toContain(editBack)
  })

  it('counts UTF-8 bytes, not JS string length, for multibyte (CJK) content', () => {
    // Each CJK character below is 3 bytes in UTF-8 but 1 UTF-16 code unit
    // (1 JS string .length), so byte count must diverge from .length.
    const dsl = 'A->B: 你好世界'
    const pageText = '页面内容测试'

    const result = buildCopyForAiPrompt({
      dslLabel: 'ZenUML',
      fenceLang: 'zenuml',
      diagramTitle: 'T',
      dsl,
      page: { title: 'P', url: 'https://x', text: pageText },
    })

    expect(result.dslBytes).toBe(new TextEncoder().encode(dsl).length)
    expect(result.dslBytes).toBeGreaterThan(dsl.length)
    expect(result.pageBytes).toBe(new TextEncoder().encode(pageText).length)
    expect(result.pageBytes).toBeGreaterThan(pageText.length)
  })

  it('escalates the fence when the dsl contains a run of backticks matching the default fence length', () => {
    const dsl = 'before\n' + '`'.repeat(3) + '\nembedded fence\n' + '`'.repeat(3) + '\nafter'
    // Longest run in dsl is 3 backticks -> fence must be strictly longer: 4.
    const expectedFence = '`'.repeat(4)

    const result = buildCopyForAiPrompt({
      dslLabel: 'Mermaid',
      fenceLang: 'mermaid',
      diagramTitle: 'T',
      dsl,
    })

    expect(result.text).toContain(`${expectedFence}mermaid\n${dsl}\n${expectedFence}`)
  })

  it('escalates further for a longer embedded backtick run', () => {
    const dsl = 'x ' + '`'.repeat(6) + ' y'
    const expectedFence = '`'.repeat(7)

    const result = buildCopyForAiPrompt({
      dslLabel: 'Mermaid',
      fenceLang: 'mermaid',
      diagramTitle: 'T',
      dsl,
    })

    expect(result.text).toContain(`${expectedFence}mermaid\n${dsl}\n${expectedFence}`)
  })

  it('omits the ": {title}" suffix and keeps a bare "## Diagram" heading when diagramTitle is empty', () => {
    const result = buildCopyForAiPrompt({
      dslLabel: 'ZenUML',
      fenceLang: 'zenuml',
      diagramTitle: '',
      dsl: 'A->B: hi',
    })

    expect(result.text).toContain('## Diagram\n\n')
    expect(result.text).not.toContain('## Diagram:')
  })

  it('omits the URL line (but keeps the ## Page heading + text) when page.url is empty', () => {
    const result = buildCopyForAiPrompt({
      dslLabel: 'ZenUML',
      fenceLang: 'zenuml',
      diagramTitle: 'Checkout flow',
      dsl: 'A->B: hi',
      page: { title: 'Checkout design', url: '', text: 'Some page body text.' },
    })

    expect(result.text).toContain('## Page: Checkout design\n\nSome page body text.')
    expect(result.text).not.toMatch(/## Page:.*\nhttps?:\/\//)
    // Page context still counts as present — the URL is best-effort, not load-bearing.
    expect(result.pageBytes).toBeGreaterThan(0)
  })

  it('omits the URL line when page.url is whitespace-only', () => {
    const result = buildCopyForAiPrompt({
      dslLabel: 'ZenUML',
      fenceLang: 'zenuml',
      diagramTitle: 'Checkout flow',
      dsl: 'A->B: hi',
      page: { title: 'Checkout design', url: '   ', text: 'Some page body text.' },
    })

    expect(result.text).toContain('## Page: Checkout design\n\nSome page body text.')
  })

  it('treats a page whose text is empty (or whitespace-only) after stripping as no page: falls back', () => {
    const result = buildCopyForAiPrompt({
      dslLabel: 'ZenUML',
      fenceLang: 'zenuml',
      diagramTitle: 'T',
      dsl: 'A->B: hi',
      page: { title: 'Empty page', url: 'https://x', text: '   \n\t  ' },
    })

    expect(result.text).not.toContain('## Page')
    expect(result.pageBytes).toBe(0)
  })
})
