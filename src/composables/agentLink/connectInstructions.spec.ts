import { describe, it, expect, afterEach } from 'vitest'
import forgeGlobal from '@/model/globals/forgeGlobal'
import { buildConnectPrompt, buildHeadlessPrompt, buildHomepagePrompt, mcpAddCommand, mcpBackendBaseUrl, mcpServerName, mcpServerUrl } from './connectInstructions'

describe('connectInstructions', () => {
  afterEach(() => {
    forgeGlobal.zenumlRemoteBaseUrl = undefined
    forgeGlobal.forgeContext = undefined
    forgeGlobal.isLite = undefined
    forgeGlobal.isDiagramly = false
    forgeGlobal.isAsyncApi = false
  })

  // ADR 0011: Full's MCP URL is the Lite backend for the same environment,
  // because Full's sign-in completes there; every other product keeps its own.
  it.each([
    ['Full', {}, 'PRODUCTION', 'https://conf-full.zenuml.com', 'https://conf-lite.zenuml.com'],
    ['Full', {}, 'STAGING', 'https://conf-stg-full.zenuml.com', 'https://conf-stg-lite.zenuml.com'],
    ['Full', {}, 'DEVELOPMENT', 'https://conf-stg-full.zenuml.com', 'https://conf-stg-lite.zenuml.com'],
    ['Lite', { isLite: true }, 'PRODUCTION', 'https://conf-lite.zenuml.com', 'https://conf-lite.zenuml.com'],
    ['Diagramly', { isDiagramly: true }, 'PRODUCTION', 'https://conf-lite.zenuml.com', 'https://conf-lite.zenuml.com'],
    ['AsyncAPI', { isAsyncApi: true }, 'PRODUCTION', 'https://zenapi.zenuml.com', 'https://zenapi.zenuml.com'],
  ])('%s %s: the MCP server lives on %s → %s', (_name, flags, environmentType, ownBackend, expected) => {
    const product = { ...flags, zenumlRemoteBaseUrl: ownBackend, forgeContext: { environmentType } }
    expect(mcpBackendBaseUrl(product)).toBe(expected)
  })

  it("keeps Full on its own backend until the Forge environment is known", () => {
    expect(mcpBackendBaseUrl({ zenumlRemoteBaseUrl: 'https://conf-full.zenuml.com' })).toBe('https://conf-full.zenuml.com')
  })

  it("puts the Lite backend in Full's production setup command", () => {
    forgeGlobal.zenumlRemoteBaseUrl = 'https://conf-full.zenuml.com'
    forgeGlobal.forgeContext = { environmentType: 'PRODUCTION' }
    expect(mcpAddCommand()).toBe('claude mcp add --transport http zenuml https://conf-lite.zenuml.com/agent-link/mcp')
  })

  it.each([
    [{}, 'zenuml'],
    [{ isDiagramly: true }, 'diagramly'],
    [{ isAsyncApi: true }, 'asyncapi'],
  ])('names the MCP server after the product (%o -> %s)', (product, name) => {
    expect(mcpServerName(product)).toBe(name)
  })

  it('uses the product name in the setup command and the prompt', () => {
    forgeGlobal.isDiagramly = true
    expect(mcpAddCommand('https://conf-lite.zenuml.com')).toBe(
      'claude mcp add --transport http diagramly https://conf-lite.zenuml.com/agent-link/mcp'
    )
    expect(buildHeadlessPrompt({ cloudId: 'c-1', contentId: '99' })).toMatch(/^Use the diagramly MCP to review my Diagramly diagram/)
    forgeGlobal.isDiagramly = false
    forgeGlobal.isAsyncApi = true
    expect(buildHeadlessPrompt({ cloudId: 'c-1', contentId: '99' })).toMatch(/^Use the asyncapi MCP to review my AsyncAPI diagram/)
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

  it('asks the agent to list the viewer\'s diagrams on the Home page, which names no diagram', () => {
    expect(buildHomepagePrompt({ cloudId: 'c-1' })).toBe([
      'Use the zenuml MCP to work with my ZenUML diagrams in Confluence.',
      'cloudId: c-1',
      '',
      '1. List my most recently modified diagrams with list_diagrams.',
      '2. Summarize what each one shows.',
      '3. Ask me which one to work on, and wait for my go-ahead before changing it with update_diagram.',
    ].join('\n'))
  })

  it('finds the site with list_sites when the Home page has no cloudId', () => {
    const prompt = buildHomepagePrompt()
    expect(prompt).toContain('Find the site with list_sites.')
    expect(prompt).not.toContain('cloudId')
  })
})
