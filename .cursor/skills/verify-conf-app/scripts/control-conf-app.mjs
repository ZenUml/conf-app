#!/usr/bin/env node
/**
 * Agent-facing CLI for the ZenUML Confluence app verification skill.
 * Storybook runs are isolated. The Confluence staging browser session is shared
 * and is never started by `launch`.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const SKILL_DIR = path.resolve(SCRIPT_DIR, '..')
const REPO_ROOT = path.resolve(SKILL_DIR, '../../..')
const RUN_DIR = path.join(SKILL_DIR, '.run')
const STATE_PATH = path.join(RUN_DIR, 'state.json')
const LOG_PATH = path.join(RUN_DIR, 'storybook.log')
const ARTIFACT_DIR = path.join(SKILL_DIR, 'artifacts')
const CONFLUENCE_LOCK = path.join(RUN_DIR, 'confluence.lock')
const STORYBOOK_SESSION = 'conf-app-verify'
const CONFLUENCE_SESSION = 'conf-app'
const DEFAULT_PORT_START = 6137
const LAUNCH_TIMEOUT_MS = 180_000
const STAGING_HOSTS = new Set([
  'lite-stg.atlassian.net',
  'full-stg.atlassian.net',
  'dia-stg.atlassian.net',
  'asyncapi-stg.atlassian.net',
  'zenuml-stg.atlassian.net',
])

const HELP = `control-conf-app — drive the ZenUML Confluence UI for verification

Storybook (isolated, started by this CLI):
  launch [--port N] [--dry-run]
  doctor
  stop [--dry-run]
  browser open-story <story-id>
  browser wait --testid <id> [--timeout ms]
  browser wait --selector <css> [--timeout ms]
  browser wait <ms>
  browser hover --selector <css>
  browser click --role <role> --name <accessible-name>
  browser click --testid <id>
  browser click --selector <css>
  browser fill --testid <id> --value <text>
  browser fill --selector <css> --value <text>
  browser press <key>
  browser text --testid <id>
  browser value --selector <css>
  browser query --role <role> --name <accessible-name>
  browser snapshot --path <file> [--feature <id>]
  browser screenshot --path <file> [--feature <id>]
  browser eval <expression>

Confluence staging (shared browser; does not launch a server):
  confluence doctor
  confluence open --url <https://<staging-host>/wiki/...> [--dry-run]

stdout is one JSON object. --dry-run prints the action and changes nothing.
Proof files under artifacts/ are kept across stop.
`

function out(payload, code = payload.ok ? 0 : 1) {
  process.stdout.write(`${JSON.stringify(payload)}\n`)
  process.exit(code)
}

function fail(error, hint, extra = {}) {
  out({ ok: false, error, hint, ...extra }, 1)
}

function assertRepo() {
  const pkgPath = path.join(REPO_ROOT, 'package.json')
  if (!existsSync(pkgPath)) fail('repo root not found', `expected package.json at ${pkgPath}`)
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  if (pkg.name !== 'confluence-plugin') {
    fail('unexpected package', `control-conf-app must run from the conf-app checkout, found ${pkg.name}`)
  }
}

function readState() {
  if (!existsSync(STATE_PATH)) return null
  return JSON.parse(readFileSync(STATE_PATH, 'utf8'))
}

function writeState(state) {
  mkdirSync(RUN_DIR, { recursive: true })
  writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`)
}

function pidAlive(pid) {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function freePort(start, end = start + 40) {
  if (start > end) return Promise.reject(new Error(`no free port in ${start - 41}-${end}`))
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.once('error', () => {
      freePort(start + 1, end).then(resolve, reject)
    })
    server.listen(start, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : start
      server.close(() => resolve(port))
    })
  })
}

async function fetchText(url) {
  const response = await fetch(url)
  const body = await response.text()
  return { status: response.status, body }
}

function logTail() {
  if (!existsSync(LOG_PATH)) return ''
  const text = readFileSync(LOG_PATH, 'utf8')
  return text.slice(-2000)
}

async function storyIndexReady(origin) {
  for (const pathname of ['/index.json', '/stories.json']) {
    try {
      const { status, body } = await fetchText(`${origin}${pathname}`)
      if (status === 200 && body.includes('viewer-genericviewer--default')) {
        return { ok: true, indexUrl: `${origin}${pathname}` }
      }
    } catch {
      // Storybook is still booting.
    }
  }
  return { ok: false }
}

async function doctorPayload() {
  const state = readState()
  if (!state) {
    return { ok: false, error: 'no verification instance', hint: 'Run: node .cursor/skills/verify-conf-app/scripts/control-conf-app.mjs launch' }
  }
  const alive = pidAlive(state.pid)
  let index = { ok: false }
  if (alive) index = await storyIndexReady(state.origin)
  const worthDriving = alive && index.ok
  return {
    ok: worthDriving,
    surface: 'storybook',
    pid: state.pid,
    port: state.port,
    origin: state.origin,
    processAlive: alive,
    storyIndexReady: index.ok,
    indexUrl: index.indexUrl ?? null,
    build: 'storybook',
    productType: 'lite',
    session: STORYBOOK_SESSION,
    hint: worthDriving ? undefined : 'The saved instance is not usable. Run stop, then launch.',
  }
}

function parseArgs(argv) {
  const flags = { _: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--dry-run') flags.dryRun = true
    else if (token === '--json') flags.json = true
    else if (token.startsWith('--')) {
      const key = token.slice(2)
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) flags[key] = true
      else {
        flags[key] = next
        i += 1
      }
    } else flags._.push(token)
  }
  return flags
}

function agentBrowser(args, { session = STORYBOOK_SESSION, restore } = {}) {
  const prefix = ['--session', session, '--json']
  if (restore) prefix.push('--restore', restore)
  const result = spawnSync('agent-browser', [...prefix, ...args], {
    encoding: 'utf8',
    timeout: 120_000,
  })
  let parsed = null
  const stdout = (result.stdout || '').trim()
  if (stdout) {
    try { parsed = JSON.parse(stdout) } catch { parsed = { raw: stdout } }
  }
  return {
    ok: result.status === 0,
    status: result.status,
    parsed,
    stderr: (result.stderr || '').trim(),
    error: result.error ? String(result.error.message || result.error) : undefined,
  }
}

function requireBrowserResult(result, hint) {
  if (!result.ok) {
    fail('agent-browser command failed', hint, { agent: result.parsed, stderr: result.stderr, spawnError: result.error })
  }
  return result
}

function artifactPath(file) {
  const resolved = path.isAbsolute(file) ? file : path.resolve(REPO_ROOT, file)
  mkdirSync(path.dirname(resolved), { recursive: true })
  return resolved
}

function writeProofNote(file, feature, extra) {
  if (!feature) return
  const note = `${file}.json`
  writeFileSync(note, `${JSON.stringify({
    feature,
    capturedAt: new Date().toISOString(),
    surface: 'storybook',
    session: STORYBOOK_SESSION,
    ...extra,
  }, null, 2)}\n`)
}

function storyUrl(origin, storyId) {
  return `${origin}/iframe.html?id=${encodeURIComponent(storyId)}&viewMode=story`
}

function agentData(parsed) {
  if (parsed && typeof parsed === 'object' && parsed.success === true && parsed.data && typeof parsed.data === 'object') {
    return parsed.data
  }
  return parsed
}

function evalText(result) {
  const data = agentData(result.parsed)
  if (typeof data === 'string') return data
  if (data && typeof data === 'object') {
    if (typeof data.result === 'string') return data.result
    if (typeof data.text === 'string') return data.text
    if (typeof data.value === 'string') return data.value
  }
  return ''
}

async function cmdLaunch(flags) {
  const state = readState()
  if (state && pidAlive(state.pid)) {
    const existing = await doctorPayload()
    if (existing.ok) out({ ...existing, reused: true })
    fail('a storybook process is already recorded but not ready', 'Run stop, then launch.', { pid: state.pid, port: state.port })
  }
  if (flags.dryRun) {
    out({
      ok: true,
      dryRun: true,
      would: `PRODUCT_TYPE=lite pnpm exec storybook dev --host 127.0.0.1 --port <free> --exact-port --ci --no-open --disable-telemetry`,
      cwd: REPO_ROOT,
    })
  }
  const port = flags.port ? Number(flags.port) : await freePort(DEFAULT_PORT_START)
  if (!Number.isInteger(port) || port <= 0) fail('invalid port', 'Pass --port with an integer.')
  mkdirSync(RUN_DIR, { recursive: true })
  const logFd = openSync(LOG_PATH, 'a')
  const child = spawn('pnpm', [
    'exec', 'storybook', 'dev',
    '--host', '127.0.0.1',
    '--port', String(port),
    '--exact-port',
    '--ci',
    '--no-open',
    '--disable-telemetry',
  ], {
    cwd: REPO_ROOT,
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: { ...process.env, PRODUCT_TYPE: 'lite', CI: '1' },
  })
  child.unref()
  const origin = `http://127.0.0.1:${port}`
  writeState({
    pid: child.pid,
    port,
    origin,
    startedAt: new Date().toISOString(),
    cwd: REPO_ROOT,
    session: STORYBOOK_SESSION,
  })
  const deadline = Date.now() + LAUNCH_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (!pidAlive(child.pid)) {
      fail('storybook exited during startup', 'Read .cursor/skills/verify-conf-app/.run/storybook.log', { logTail: logTail() })
    }
    const ready = await storyIndexReady(origin)
    if (ready.ok) {
      out({ ok: true, reused: false, pid: child.pid, port, origin, indexUrl: ready.indexUrl, session: STORYBOOK_SESSION })
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  fail('storybook did not become ready', 'index.json never listed viewer-genericviewer--default', { port, pid: child.pid, logTail: logTail() })
}

function killGroup(pid) {
  try { process.kill(-pid, 'SIGTERM') } catch { try { process.kill(pid, 'SIGTERM') } catch { /* already gone */ } }
}

async function cmdStop(flags) {
  const state = readState()
  if (!state) out({ ok: true, stopped: false, reason: 'no instance', artifacts: ARTIFACT_DIR })
  if (flags.dryRun) {
    out({ ok: true, dryRun: true, wouldKillPid: state.pid, wouldCloseSession: STORYBOOK_SESSION, wouldKeep: ARTIFACT_DIR })
  }
  agentBrowser(['close'], { session: STORYBOOK_SESSION })
  if (pidAlive(state.pid)) {
    killGroup(state.pid)
    const deadline = Date.now() + 8000
    while (pidAlive(state.pid) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    if (pidAlive(state.pid)) {
      try { process.kill(-state.pid, 'SIGKILL') } catch { try { process.kill(state.pid, 'SIGKILL') } catch { /* gone */ } }
    }
  }
  rmSync(STATE_PATH, { force: true })
  out({
    ok: true,
    stopped: true,
    pid: state.pid,
    processAlive: pidAlive(state.pid),
    artifactsKept: ARTIFACT_DIR,
  })
}

function requireInstance() {
  const state = readState()
  if (!state || !pidAlive(state.pid)) {
    fail('no live storybook instance', 'Run launch, then doctor, before browser commands.')
  }
  return state
}

function selectorFrom(flags) {
  if (flags.testid) return `[data-testid="${flags.testid}"]`
  if (flags.selector) return flags.selector
  return null
}

async function cmdBrowser(flags) {
  const action = flags._[0]
  if (!action) fail('missing browser action', HELP)
  const state = action === 'eval' ? readState() : requireInstance()
  if (action === 'open-story') {
    const storyId = flags._[1]
    if (!storyId) fail('missing story id', 'Example: browser open-story viewer-genericviewer--default')
    const url = storyUrl(state.origin, storyId)
    requireBrowserResult(agentBrowser(['set', 'viewport', '1440', '900']), 'Could not set a desktop viewport.')
    requireBrowserResult(agentBrowser(['open', url]), `Could not open ${url}`)
    writeState({ ...state, lastStoryId: storyId, lastUrl: url })
    out({ ok: true, url, storyId, session: STORYBOOK_SESSION, viewport: '1440x900' })
  }
  if (action === 'wait') {
    const selector = selectorFrom(flags)
    const timeout = Number(flags.timeout || 60_000)
    if (!selector && flags._[1] && /^\d+$/.test(flags._[1])) {
      requireBrowserResult(agentBrowser(['wait', flags._[1]]), 'Timed wait failed.')
      out({ ok: true, waitedMs: Number(flags._[1]) })
    }
    if (!selector) fail('wait needs --testid, --selector, or a millisecond count', HELP)
    const deadline = Date.now() + timeout
    let last = null
    const expression = `document.querySelector(${JSON.stringify(selector)}) ? 'present' : 'absent'`
    while (Date.now() < deadline) {
      last = agentBrowser(['eval', expression])
      if (evalText(last) === 'present') out({ ok: true, selector, session: STORYBOOK_SESSION })
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    fail(`timed out waiting for ${selector}`, 'The story may still be compiling, or the handle changed.', { last })
  }
  if (action === 'hover') {
    if (!flags.selector) fail('hover needs --selector', 'Example: browser hover --selector .viewer-surface')
    requireBrowserResult(agentBrowser(['hover', flags.selector]), `Could not hover ${flags.selector}`)
    out({ ok: true, hovered: flags.selector })
  }
  if (action === 'click') {
    if (flags.role && flags.name) {
      requireBrowserResult(agentBrowser(['find', 'role', flags.role, 'click', '--name', flags.name]), `Could not click ${flags.role} "${flags.name}"`)
      out({ ok: true, clicked: { role: flags.role, name: flags.name } })
    }
    const selector = selectorFrom(flags)
    if (!selector) fail('click needs --role/--name, --testid, or --selector', HELP)
    requireBrowserResult(agentBrowser(['click', selector]), `Could not click ${selector}`)
    out({ ok: true, clicked: selector })
  }
  if (action === 'fill') {
    const selector = selectorFrom(flags)
    if (!selector || flags.value === undefined) fail('fill needs a target and --value', HELP)
    requireBrowserResult(agentBrowser(['fill', selector, flags.value]), `Could not fill ${selector}`)
    out({ ok: true, filled: selector })
  }
  if (action === 'press') {
    const key = flags._[1]
    if (!key) fail('press needs a key', 'Example: browser press Enter')
    requireBrowserResult(agentBrowser(['press', key]), `Could not press ${key}`)
    out({ ok: true, pressed: key })
  }
  if (action === 'text' || action === 'value') {
    const selector = selectorFrom(flags)
    if (!selector) fail(`${action} needs --testid or --selector`, HELP)
    const result = requireBrowserResult(agentBrowser(['get', action, selector]), `Could not read ${action} of ${selector}`)
    const data = agentData(result.parsed)
    const value = data && typeof data === 'object' && typeof data[action] === 'string' ? data[action] : data
    out({ ok: true, selector, [action]: value })
  }
  if (action === 'query') {
    if (!flags.role || !flags.name) fail('query needs --role and --name', HELP)
    const expression = `(() => {
      const name = ${JSON.stringify(flags.name)};
      const role = ${JSON.stringify(flags.role)};
      const nodes = [...document.querySelectorAll(role === 'button' ? 'button, [role="button"]' : '[role="' + role + '"]')];
      const node = nodes.find((el) => ((el.getAttribute('aria-label') || el.innerText || '').trim()) === name);
      if (!node) return { found: false };
      const style = getComputedStyle(node);
      return { found: true, disabled: !!node.disabled, opacity: style.opacity, text: (node.innerText || '').trim() };
    })()`
    const result = requireBrowserResult(agentBrowser(['eval', expression]), 'Could not query the control.')
    const data = agentData(result.parsed)
    out({ ok: true, query: data && typeof data === 'object' && 'result' in data ? data.result : data, role: flags.role, name: flags.name })
  }
  if (action === 'snapshot' || action === 'screenshot') {
    if (!flags.path) fail(`${action} needs --path`, 'Proof files must have an explicit path.')
    const file = artifactPath(flags.path)
    const args = action === 'snapshot' ? ['snapshot', '-i'] : ['screenshot', file]
    const result = requireBrowserResult(agentBrowser(args), `${action} failed`)
    if (action === 'snapshot') {
      const data = agentData(result.parsed)
      const body = data && typeof data === 'object' && typeof data.snapshot === 'string'
        ? data.snapshot
        : (typeof result.parsed === 'string' ? result.parsed : JSON.stringify(result.parsed, null, 2))
      writeFileSync(file, `${body}\n`)
    }
    writeProofNote(file, flags.feature, { storyId: state.lastStoryId ?? null, url: state.lastUrl ?? null, kind: action })
    out({ ok: true, path: file, feature: flags.feature ?? null, bytes: statSync(file).size })
  }
  if (action === 'eval') {
    const expression = flags._.slice(1).join(' ')
    if (!expression) fail('eval needs an expression', HELP)
    const result = requireBrowserResult(agentBrowser(['eval', expression]), 'eval failed')
    out({ ok: true, result: result.parsed })
  }
  fail(`unknown browser action ${action}`, HELP)
}

function confluenceSessionFile() {
  return path.join(homedir(), '.agent-browser', 'sessions', 'stg-conf-app.json')
}

function cmdConfluence(flags) {
  const action = flags._[0]
  if (action === 'doctor') {
    const file = confluenceSessionFile()
    const present = existsSync(file)
    const info = present ? statSync(file) : null
    out({
      ok: present,
      surface: 'confluence-staging',
      session: CONFLUENCE_SESSION,
      restore: 'stg',
      sessionFile: file,
      sessionBytes: info ? info.size : 0,
      sessionMtime: info ? info.mtime.toISOString() : null,
      browserOpened: false,
      hint: present
        ? 'Session file exists. This doctor does not open the shared browser. A file on disk does not prove the login is still valid.'
        : 'Missing ~/.agent-browser/sessions/stg-conf-app.json. Restore the robot1yanhui staging session before a Confluence drive.',
    }, present ? 0 : 1)
  }
  if (action === 'open') {
    if (!flags.url) fail('confluence open needs --url', 'Pass a /wiki/ URL on a staging host.')
    let parsed
    try { parsed = new URL(flags.url) } catch { fail('invalid url', flags.url) }
    if (parsed.protocol !== 'https:' || !STAGING_HOSTS.has(parsed.host) || !parsed.pathname.startsWith('/wiki/')) {
      fail('url is outside the staging allowlist', `Allowed hosts: ${[...STAGING_HOSTS].join(', ')}. Path must start with /wiki/.`)
    }
    if (flags.dryRun) out({ ok: true, dryRun: true, wouldOpen: parsed.toString(), session: CONFLUENCE_SESSION, restore: 'stg' })
    if (existsSync(CONFLUENCE_LOCK)) {
      const lock = JSON.parse(readFileSync(CONFLUENCE_LOCK, 'utf8'))
      if (pidAlive(lock.pid)) fail('another verification run holds the shared Confluence session', `lock pid ${lock.pid}`)
    }
    mkdirSync(RUN_DIR, { recursive: true })
    writeFileSync(CONFLUENCE_LOCK, `${JSON.stringify({ pid: process.pid, url: parsed.toString(), at: new Date().toISOString() })}\n`)
    const result = agentBrowser(['open', parsed.toString()], { session: CONFLUENCE_SESSION, restore: 'stg' })
    rmSync(CONFLUENCE_LOCK, { force: true })
    if (!result.ok) fail('could not open the Confluence page', 'The shared session may be logged out.', { agent: result.parsed, stderr: result.stderr })
    out({ ok: true, url: parsed.toString(), session: CONFLUENCE_SESSION, shared: true })
  }
  fail('unknown confluence action', 'Use: confluence doctor | confluence open --url <url>')
}

async function main() {
  const flags = parseArgs(process.argv.slice(2))
  const command = flags._[0]
  if (!command || command === 'help' || flags.help) out({ ok: true, help: HELP })
  assertRepo()
  if (command === 'doctor') {
    const report = await doctorPayload()
    out(report, report.ok ? 0 : 1)
  }
  if (command === 'launch') await cmdLaunch(flags)
  if (command === 'stop') await cmdStop(flags)
  if (command === 'browser') {
    flags._.shift()
    await cmdBrowser(flags)
  }
  if (command === 'confluence') {
    flags._.shift()
    cmdConfluence(flags)
  }
  fail(`unknown command ${command}`, HELP, {})
}

main().catch((error) => {
  out({ ok: false, error: error instanceof Error ? error.message : String(error) }, 1)
})
