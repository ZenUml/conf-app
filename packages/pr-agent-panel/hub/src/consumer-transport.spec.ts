import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { connect, type Server, type Socket } from 'node:net'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CLIENT_EVENT_METHOD, HOOK_METHOD } from '@zenuml/pr-panel-shared'
import { listenConsumerSocket } from './consumer-transport'
import type { HubRuntime } from './runtime'
import { PR, REPO, connectExtension, frame, makeRuntime } from './test-helpers'

const LIFECYCLE = resolve(__dirname, '../../agent-plugin/clients/shared/lifecycle.mjs')
let server: Server | null = null

afterEach(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()))
  server = null
})

async function startSocket(): Promise<{ runtime: HubRuntime; dir: string; path: string }> {
  const { runtime, dir } = makeRuntime()
  const path = join(dir, 'hub.sock')
  server = await listenConsumerSocket(path, runtime)
  return { runtime, dir, path }
}

function lines(socket: Socket): { next(): Promise<Record<string, unknown>> } {
  let buffer = ''
  const queue: Record<string, unknown>[] = []
  const waiters: ((v: Record<string, unknown>) => void)[] = []
  socket.on('data', (d) => {
    buffer += d.toString()
    let i: number
    while ((i = buffer.indexOf('\n')) >= 0) {
      const msg = JSON.parse(buffer.slice(0, i)) as Record<string, unknown>
      buffer = buffer.slice(i + 1)
      const w = waiters.shift()
      if (w) w(msg)
      else queue.push(msg)
    }
  })
  return { next: () => (queue.length ? Promise.resolve(queue.shift()!) : new Promise((r) => waiters.push(r))) }
}

function runLifecycle(dir: string, input: object): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [LIFECYCLE, 'claude'], { env: { ...process.env, PR_PANEL_RUNTIME_DIR: dir } })
    let stdout = ''
    child.stdout.on('data', (d) => (stdout += d.toString()))
    child.on('exit', (code) => resolvePromise({ code, stdout }))
    child.stdin.end(JSON.stringify(input))
  })
}

describe('consumer socket', () => {
  it('routes an announced connection into an MCP session', async () => {
    const { runtime, path } = await startSocket()
    const socket = connect(path)
    await new Promise((r) => socket.once('connect', r))
    const reader = lines(socket)
    socket.write(
      `${JSON.stringify({ jsonrpc: '2.0', method: CLIENT_EVENT_METHOD, params: { event: 'connect', kind: 'codex', sessionId: 't1' } })}\n` +
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } },
        })}\n`,
    )
    const init = await reader.next()
    expect(init.id).toBe(1)
    expect((init.result as { serverInfo: { name: string } }).serverInfo.name).toBe('pr-panel')
    expect(runtime.agentCount).toBe(1)
    expect(runtime.snapshot().agents[0]).toMatchObject({ kind: 'codex', sessionId: 't1' })
    socket.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`)
    socket.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`)
    const list = await reader.next()
    expect((list.result as { tools: unknown[] }).tools).toHaveLength(9)
    socket.destroy()
    await new Promise((r) => setTimeout(r, 30))
    expect(runtime.agentCount).toBe(0)
  })

  it('answers a one-shot hook request and closes', async () => {
    const { path } = await startSocket()
    const socket = connect(path)
    await new Promise((r) => socket.once('connect', r))
    const reader = lines(socket)
    const closed = new Promise((r) => socket.once('close', r))
    socket.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 7,
        method: HOOK_METHOD,
        params: { version: 1, kind: 'claude', sessionId: 's', event: 'PreToolUse', invocationId: randomUUID() },
      })}\n`,
    )
    const reply = await reader.next()
    expect(reply).toEqual({ jsonrpc: '2.0', id: 7, result: { deliveredMessageIds: [] } })
    await closed
  })

  it('lifecycle.mjs binds the task on PostToolUse and prints queued messages as hook output', async () => {
    const { runtime, dir } = await startSocket()
    const conn = connectExtension(runtime)
    runtime.handleExtensionFrame(conn.id, frame('register', { documentId: 'd1', pr: PR }))
    const agent = runtime.connectAgent({ kind: 'claude_code', connectedAt: 1 })
    const { taskId } = runtime.beginTask(agent, { repo: REPO, prNumber: 7, kind: 'review' })

    const post = await runLifecycle(dir, {
      session_id: 'sess-1',
      hook_event_name: 'PostToolUse',
      tool_name: 'mcp__plugin_pr-panel_pr-panel__begin_task',
      tool_response: [{ type: 'text', text: `Task started.\n${JSON.stringify({ taskId, documentId: 'd1', pendingMessages: [] })}` }],
    })
    expect(post).toEqual({ code: 0, stdout: '' })
    expect(runtime.hooks.session('claude', 'sess-1')?.boundTaskIds.has(taskId)).toBe(true)

    runtime.handleExtensionFrame(conn.id, frame('userMessage', { documentId: 'd1', text: 'Look at the tests' }))
    const pre = await runLifecycle(dir, { session_id: 'sess-1', hook_event_name: 'PreToolUse', tool_name: 'Bash' })
    expect(pre.code).toBe(0)
    const output = JSON.parse(pre.stdout) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } }
    expect(output.hookSpecificOutput.hookEventName).toBe('PreToolUse')
    expect(output.hookSpecificOutput.additionalContext).toContain('Look at the tests')

    runtime.handleExtensionFrame(conn.id, frame('userMessage', { documentId: 'd1', text: 'And docs' }))
    const stop = await runLifecycle(dir, { session_id: 'sess-1', hook_event_name: 'Stop', stop_hook_active: false })
    expect(JSON.parse(stop.stdout)).toMatchObject({ decision: 'block' })

    // Subagent calls are ignored entirely.
    runtime.handleExtensionFrame(conn.id, frame('userMessage', { documentId: 'd1', text: 'Third' }))
    const sub = await runLifecycle(dir, { session_id: 'sess-1', agent_id: 'a1', hook_event_name: 'PreToolUse' })
    expect(sub).toEqual({ code: 0, stdout: '' })
    expect(runtime.queue.pending()).toHaveLength(1)
  })

  it('lifecycle.mjs exits 0 silently when no Hub is running', async () => {
    const { dir } = makeRuntime()
    const result = await runLifecycle(dir, { session_id: 's', hook_event_name: 'Stop' })
    expect(result).toEqual({ code: 0, stdout: '' })
  })
})
