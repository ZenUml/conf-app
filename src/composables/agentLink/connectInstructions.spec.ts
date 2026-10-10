import { describe, it, expect, afterEach } from 'vitest'
import forgeGlobal from '@/model/globals/forgeGlobal'
import { buildConnectPrompt, buildHeadlessPrompt, mcpAddCommand, mcpServerUrl } from './connectInstructions'

describe('connectInstructions', () => {
  afterEach(() => {
    forgeGlobal.zenumlRemoteBaseUrl = undefined
  })

  it.each([
    ['https://conf-lite.zenuml.com', 'https://conf-lite.zenuml.com/agent-link/mcp'],
    ['https://conf-full.zenuml.com', 'https://conf-full.zenuml.com/agent-link/mcp'],
    ['https://conf-stg-lite.zenuml.com/', 'https://conf-stg-lite.zenuml.com/agent-link/mcp'],
  ])("points the MCP server at this macro's backend (%s)", (base, expected) => {
    forgeGlobal.zenumlRemoteBaseUrl = base
    expect(mcpServerUrl()).toBe(expected)
    expect(mcpAddCommand()).toBe(`claude mcp add --transport http zenuml ${expected}`)
  })

  it('accepts an explicit backend base URL', () => {
    expect(mcpServerUrl('http://localhost:8080')).toBe('http://localhost:8080/agent-link/mcp')
  })

  it('falls back to the production Lite host when no backend is resolved', () => {
    expect(mcpServerUrl()).toBe('https://conf-lite.zenuml.com/agent-link/mcp')
  })

  it('builds the relay session prompt', () => {
    expect(buildConnectPrompt('CL-7F3K-Q9M2')).toContain('session: CL-7F3K-Q9M2')
  })

  it('asks for a review of the diagram, named by the ids the headless tools take', () => {
    expect(buildHeadlessPrompt({ title: ' Login flow ', cloudId: 'c-1', pageId: '42', contentId: '99' })).toBe([
      'Use the zenuml MCP to review my ZenUML diagram "Login flow".',
      'cloudId: c-1',
      'pageId: 42',
      'contentId: 99',
      '',
      '1. Read it with read_diagram, and the page with read_page for context.',
      '2. Summarize what the diagram shows.',
      '3. Point out anything unclear, inconsistent or missing.',
      '4. Suggest improvements, then wait for my go-ahead before changing it with update_diagram.',
    ].join('\n'))
  })

  it('reads only the diagram when the page is unknown', () => {
    const prompt = buildHeadlessPrompt({ cloudId: 'c-1', contentId: '99' })
    expect(prompt).toContain('1. Read it with read_diagram.')
    expect(prompt).not.toContain('read_page')
  })

  it('falls back to lookups when ids are missing (unsaved macro, no Forge context)', () => {
    const prompt = buildHeadlessPrompt({ pageId: '42' })
    expect(prompt).toContain('my ZenUML diagram on this page.')
    expect(prompt).toContain('Find the site with list_sites.')
    expect(prompt).toContain('Find it with list_diagrams for this page')
    expect(prompt).not.toContain('contentId')
  })
})
