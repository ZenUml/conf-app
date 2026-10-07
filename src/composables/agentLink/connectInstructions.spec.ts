import { describe, it, expect, afterEach } from 'vitest'
import forgeGlobal from '@/model/globals/forgeGlobal'
import { buildConnectPrompt, isUsableSessionToken, mcpAddCommand, mcpServerUrl } from './connectInstructions'

describe('connectInstructions', () => {
  afterEach(() => {
    forgeGlobal.zenumlRemoteBaseUrl = undefined
  })

  it.each([
    ['https://conf-lite.zenuml.com', 'https://conf-lite.zenuml.com/agent-link/mcp'],
    ['https://conf-full.zenuml.com', 'https://conf-full.zenuml.com/agent-link/mcp'],
    ['https://conf-stg-lite.zenuml.com/', 'https://conf-stg-lite.zenuml.com/agent-link/mcp'],
  ])('points the MCP server at the backend that mints the session (%s)', (base, expected) => {
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

  it('builds the prompt and rejects the local pending placeholder token', () => {
    expect(buildConnectPrompt('CL-7F3K-Q9M2')).toContain('session: CL-7F3K-Q9M2')
    expect(isUsableSessionToken('CL-7F3K-Q9M2')).toBe(true)
    expect(isUsableSessionToken('pending-1700000000000')).toBe(false)
    expect(isUsableSessionToken(null)).toBe(false)
  })
})
