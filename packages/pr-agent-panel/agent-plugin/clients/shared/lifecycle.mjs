// Adapted from TemPad Dev's agent-plugin lifecycle.mjs (MIT, Baidu EFE team; see THIRD_PARTY_NOTICES.md).
// Claude Code lifecycle hook: forwards the event to the local PR Panel Hub and prints the Hub's hook
// output (queued panel messages as additionalContext, or a Stop block). Never launches anything,
// never fails the host: every path exits 0, within 1500 ms.
import { randomUUID } from 'node:crypto'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

const HOOK_METHOD = 'prpanel/client-hook'
const EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SessionEnd']
const BEGIN_TASK_TOOL = /pr[-_]panel.*__begin_task$/

let socket
const deadline = setTimeout(() => process.exit(0), 1500)

function socketPath() {
  if (process.platform === 'win32') return '\\\\.\\pipe\\zenuml-pr-panel'
  const dir = process.env.PR_PANEL_RUNTIME_DIR || join(tmpdir(), 'zenuml-pr-panel')
  return join(dir, 'hub.sock')
}

function taskIdFrom(response) {
  // Claude Code passes an MCP tool's structured result as a JSON string (verified live,
  // 2026-10-23); other hosts may pass the raw MCP result object or its content array.
  if (typeof response === 'string') {
    try {
      response = JSON.parse(response)
    } catch {
      return undefined
    }
  }
  if (!response || typeof response !== 'object' || response.isError) return undefined
  let result = response.structuredContent || response.result?.structuredContent || response
  if (typeof result?.taskId !== 'string') {
    const content = Array.isArray(response) ? response : response.content
    if (Array.isArray(content)) {
      const text = content.find((value) => value?.type === 'text')?.text
      if (typeof text === 'string') {
        // The Hub's text content is a summary line followed by the JSON result.
        for (const candidate of [text, text.slice(text.indexOf('\n') + 1)]) {
          try {
            result = JSON.parse(candidate)
            break
          } catch {
            /* not JSON */
          }
        }
      }
    }
  }
  return typeof result?.taskId === 'string' && result.taskId.length <= 128 ? result.taskId : undefined
}

try {
  let text = ''
  for await (const chunk of process.stdin) {
    text += String(chunk)
    if (text.length > 1_000_000) process.exit(0)
  }
  const input = JSON.parse(text)
  // Subagent invocations share the parent's session id; they are not the conversation the user sees.
  if (typeof input.session_id !== 'string' || input.agent_id || input.subagent_id) process.exit(0)
  const event = input.hook_event_name
  if (!EVENTS.includes(event)) process.exit(0)

  let taskId
  if (event === 'PostToolUse' && BEGIN_TASK_TOOL.test(input.tool_name || '')) taskId = taskIdFrom(input.tool_response)

  const params = {
    version: 1,
    kind: process.argv[2] === 'codex' ? 'codex' : 'claude',
    sessionId: input.session_id.slice(0, 256),
    event,
    invocationId: randomUUID(),
    ...(typeof input.cwd === 'string' ? { cwd: input.cwd.slice(0, 4096) } : {}),
    ...(typeof input.turn_id === 'string' ? { turnId: input.turn_id.slice(0, 256) } : {}),
    ...(taskId ? { taskId } : {}),
    ...(event === 'Stop' ? { stopHookActive: input.stop_hook_active === true } : {}),
  }

  socket = connect(socketPath())
  const result = await new Promise((resolve, reject) => {
    let buffer = ''
    socket.once('error', reject)
    socket.once('close', () => reject(new Error('closed')))
    socket.once('connect', () => {
      socket.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: HOOK_METHOD, params }) + '\n')
    })
    socket.on('data', (data) => {
      buffer += data.toString()
      if (buffer.length > 1_000_000) return reject(new Error('too large'))
      const index = buffer.indexOf('\n')
      if (index < 0) return
      try {
        const message = JSON.parse(buffer.slice(0, index))
        if (message.id === 1 && !message.error) resolve(message.result)
        else reject(new Error('hook rejected'))
      } catch (error) {
        reject(error)
      }
    })
  })

  const output = result?.output
  if (output && typeof output === 'object' && Object.keys(output).length > 0) {
    await new Promise((resolve, reject) => {
      process.stdout.write(JSON.stringify(output) + '\n', (error) => (error ? reject(error) : resolve()))
    })
  }
} catch {
  // No Hub, an old Hub, or bad input: the host continues as if this hook did not exist.
} finally {
  socket?.destroy()
  clearTimeout(deadline)
}
process.exit(0)
