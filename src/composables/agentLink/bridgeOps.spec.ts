import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createBridgeOps, createUnwiredBridgeOps, type AgentLinkBridge } from './bridgeOps'

const BOUND_ID = 'cc-bound-123'
const OTHER_ID = 'cc-other-999'

function makeBridge(): AgentLinkBridge {
  return {
    readPage: vi.fn().mockResolvedValue({
      pageId: 'page-1',
      title: 'My Page',
      text: 'page body text',
    }),
    readDiagram: vi.fn().mockResolvedValue({
      contentId: BOUND_ID,
      diagramType: 'sequence',
      dsl: 'A->B: hi',
    }),
    writeDiagram: vi.fn().mockResolvedValue({ ok: true, version: 2, rendered: true }),
  }
}

describe('bridgeOps', () => {
  let bridge: AgentLinkBridge

  beforeEach(() => {
    bridge = makeBridge()
  })

  it('readPage passes through to the injected bridge', async () => {
    const ops = createBridgeOps(bridge, BOUND_ID)
    const result = await ops.readPage()
    expect(bridge.readPage).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ pageId: 'page-1', title: 'My Page', text: 'page body text' })
  })

  it('readDiagram always reads the bound content id', async () => {
    const ops = createBridgeOps(bridge, BOUND_ID)
    const result = await ops.readDiagram()
    expect(bridge.readDiagram).toHaveBeenCalledWith(BOUND_ID)
    expect(result).toEqual({ contentId: BOUND_ID, diagramType: 'sequence', dsl: 'A->B: hi' })
  })

  it('writeDiagram forwards to the bound id by default', async () => {
    const ops = createBridgeOps(bridge, BOUND_ID)
    const result = await ops.writeDiagram('A->B: updated')
    expect(bridge.writeDiagram).toHaveBeenCalledWith(BOUND_ID, 'A->B: updated')
    expect(result).toEqual({ ok: true, version: 2, rendered: true })
  })

  it('writeDiagram with a different content id is denied — bridge is never called', async () => {
    const ops = createBridgeOps(bridge, BOUND_ID)
    const result = await ops.writeDiagram('A->B: sneaky', 'summary', OTHER_ID)
    expect(bridge.writeDiagram).not.toHaveBeenCalled()
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('scope_violation')
  })

  it('summary is accepted but not forwarded to the bridge', async () => {
    const ops = createBridgeOps(bridge, BOUND_ID)
    await ops.writeDiagram('A->B: hi', 'added a step')
    expect(bridge.writeDiagram).toHaveBeenCalledWith(BOUND_ID, 'A->B: hi')
  })
})

describe('createUnwiredBridgeOps', () => {
  it('every op rejects — nothing performs Confluence I/O before the real bridge exists', async () => {
    const ops = createUnwiredBridgeOps()
    await expect(ops.readPage()).rejects.toThrow(/not wired yet/)
    await expect(ops.readDiagram()).rejects.toThrow(/not wired yet/)
    await expect(ops.writeDiagram('A->B: hi')).rejects.toThrow(/not wired yet/)
  })
})
