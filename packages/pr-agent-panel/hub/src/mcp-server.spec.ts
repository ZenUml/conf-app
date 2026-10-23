import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it } from 'vitest'
import { TOOL_NAMES } from '@zenuml/pr-panel-shared'
import { createMcpServer } from './mcp-server'
import { PR, REPO, REPO_KEY, connectExtension, frame, makeRuntime } from './test-helpers'

async function connectClient() {
  const { runtime } = makeRuntime()
  const consumerId = runtime.connectAgent({ kind: 'claude_code', connectedAt: 1 })
  const server = createMcpServer(runtime, consumerId)
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new Client({ name: 'test', version: '0' })
  await client.connect(clientTransport)
  return { runtime, client }
}

describe('MCP server', () => {
  it('lists exactly the nine contract tools with output schemas', async () => {
    const { client } = await connectClient()
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort())
    expect(tools.every((t) => t.outputSchema)).toBe(true)
  })

  it('runs begin_task -> publish_review -> complete_task', async () => {
    const { runtime, client } = await connectClient()
    const conn = connectExtension(runtime)
    runtime.handleExtensionFrame(conn.id, frame('register', { documentId: 'd1', pr: PR }))

    const active = await client.callTool({ name: 'get_active_pr', arguments: {} })
    expect((active.structuredContent as { documentId: string }).documentId).toBe('d1')

    const begun = await client.callTool({
      name: 'begin_task',
      arguments: { repo: REPO, prNumber: 7, headSha: 'aaaaaaa1', label: 'Reading' },
    })
    expect(begun.isError).toBeFalsy()
    const { taskId, documentId } = begun.structuredContent as { taskId: string; documentId: string }
    expect(documentId).toBe('d1')
    expect(runtime.getTask(taskId)?.kind).toBe('review')

    const progress = await client.callTool({ name: 'report_progress', arguments: { taskId, text: 'Reading the diff' } })
    expect(progress.structuredContent).toEqual({ ok: true })

    const published = await client.callTool({
      name: 'publish_review',
      arguments: {
        taskId,
        headline: 'Ship it',
        summary: 'Small and safe.',
        priority: 'P3',
        findings: [{ severity: 'nit', explanation: 'Typo in README' }],
        tags: ['docs'],
        prState: 'open',
        mergeable: true,
      },
    })
    const { runId } = published.structuredContent as { runId: string }
    expect(runtime.store.history(REPO_KEY, 7)[0].runId).toBe(runId)
    expect(conn.last('reviews')?.items[0].headline).toBe('Ship it')

    const completed = await client.callTool({ name: 'complete_task', arguments: { taskId } })
    const task = (completed.structuredContent as { task: { status: string; runId: string } }).task
    expect(task.status).toBe('finished')
    expect(task.runId).toBe(runId)

    const history = await client.callTool({ name: 'read_review_history', arguments: { repo: REPO, prNumber: 7 } })
    expect((history.structuredContent as { runs: unknown[] }).runs).toHaveLength(1)
  })

  it('rejects bad input and reports unknown tasks as tool errors', async () => {
    const { client } = await connectClient()
    const bad = await client.callTool({ name: 'publish_review', arguments: { taskId: 'x', headline: 'h'.repeat(121), summary: 's' } })
    expect(bad.isError).toBe(true)
    const unknown = await client.callTool({ name: 'report_progress', arguments: { taskId: 'nope', text: 'x' } })
    expect(unknown.isError).toBe(true)
    expect(JSON.stringify(unknown.content)).toContain('No task nope')
  })

  it('wait_for_panel_messages returns a message typed while it waits', async () => {
    const { runtime, client } = await connectClient()
    const conn = connectExtension(runtime)
    runtime.handleExtensionFrame(conn.id, frame('register', { documentId: 'd1', pr: PR }))
    const waiting = client.callTool({ name: 'wait_for_panel_messages', arguments: { timeoutMs: 5000 } })
    await new Promise((r) => setTimeout(r, 20))
    runtime.handleExtensionFrame(conn.id, frame('userMessage', { documentId: 'd1', text: 'Go' }))
    const result = await waiting
    expect((result.structuredContent as { messages: { text: string }[] }).messages.map((m) => m.text)).toEqual(['Go'])
  })
})
