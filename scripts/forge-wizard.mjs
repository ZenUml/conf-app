import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

import { confirm, input, select } from '@inquirer/prompts'

/**
 * Single source of truth for all (app, environment) configuration required by Forge.
 * Keep this data local to this script so developers never need to memorize 28 scripts.
 */
export const APPS = {
  lite: {
    appKey: 'lite',
    appId: '8ad26115-211f-4216-971b-0540f606303d',
    connectKey: 'com.zenuml.confluence-addon-lite',
    sequenceMacroKey: 'zenuml-sequence-macro-lite',
    customContentKey: 'zenuml-content-sequence',
    liteKeySuffix: '-lite',
    liteTitleSuffix: ' Lite',
    appLabel: 'ZenUML for Confluence Lite',
    backendUrls: {
      staging: 'https://conf-stg-lite.zenuml.com',
      production: 'https://conf-lite.zenuml.com',
    },
    manifestEdits: [
      {
        description: 'Remove licensing (lite is free)',
        yqEvalExpr: 'del(.app.licensing)',
      },
      {
        description: 'Remove confluence:contentBylineItem',
        yqEvalExpr: 'del(.modules["confluence:contentBylineItem"])',
      },
      {
        description: 'Remove asyncapi macro (zenuml-asyncapi-macro)',
        yqEvalExpr:
          'del(.modules.macro[] | select(.key | test("zenuml-asyncapi-macro")))',
      },
      {
        description: 'Remove asyncapi custom content (zenuml-content-asyncapi)',
        yqEvalExpr:
          'del(.modules["confluence:customContent"][] | select(.key | test("zenuml-content-asyncapi")))',
      },
    ],
    sites: {
      staging: ['lite-stg.atlassian.net'],
      production: ['zenuml.atlassian.net'],
    },
    productType: 'lite',
    forgeAppLabelVarName: 'APP_LABEL',
  },
  full: {
    appKey: 'full',
    appId: 'd9e4002b-120b-426b-834b-402a4a5adce7',
    connectKey: 'com.zenuml.confluence-addon',
    sequenceMacroKey: 'zenuml-sequence-macro',
    customContentKey: 'zenuml-content-sequence',
    liteKeySuffix: '',
    liteTitleSuffix: '',
    appLabel: 'ZenUML for Confluence',
    backendUrls: {
      staging: 'https://conf-stg-full.zenuml.com',
      production: 'https://conf-full.zenuml.com',
    },
    manifestEdits: [
      {
        description: 'Remove asyncapi macro (zenuml-asyncapi-macro)',
        yqEvalExpr:
          'del(.modules.macro[] | select(.key | test("zenuml-asyncapi-macro")))',
      },
      {
        description: 'Remove asyncapi custom content (zenuml-content-asyncapi)',
        yqEvalExpr:
          'del(.modules["confluence:customContent"][] | select(.key | test("zenuml-content-asyncapi")))',
      },
    ],
    sites: {
      staging: ['full-stg.atlassian.net'],
      production: ['zenuml.atlassian.net'],
    },
    productType: 'full',
    buildMode: 'production',
    forgeAppLabelVarName: 'APP_LABEL',
  },
  diagramly: {
    appKey: 'diagramly',
    appId: '01ede8b1-4e88-451a-b9ef-89eeef93afaf',
    connectKey: 'gptdock-confluence',
    sequenceMacroKey: 'gpt-diagram-macro',
    customContentKey: 'gpt-custom-content-key',
    liteKeySuffix: '',
    liteTitleSuffix: '',
    appLabel: 'Diagramly for Confluence',
    backendUrls: {
      staging: 'https://conf-stg-lite.zenuml.com',
      production: 'https://conf-lite.zenuml.com',
    },
    // Diagramly includes licensing; remove only the global UI modules and embed macro.
    manifestEdits: [
      {
        description: 'Remove globalSettings + globalPage',
        yqEvalExpr:
          'del(.modules["confluence:globalSettings"]) | del(.modules["confluence:globalPage"])',
      },
      {
        description: 'Remove embed macro (zenuml-embed-macro)',
        yqEvalExpr:
          'del(.modules.macro[] | select(.key | test("zenuml-embed-macro")))',
      },
      {
        description: 'Remove asyncapi macro (zenuml-asyncapi-macro)',
        yqEvalExpr:
          'del(.modules.macro[] | select(.key | test("zenuml-asyncapi-macro")))',
      },
      {
        description: 'Remove asyncapi custom content (zenuml-content-asyncapi)',
        yqEvalExpr:
          'del(.modules["confluence:customContent"][] | select(.key | test("zenuml-content-asyncapi")))',
      },
    ],
    sites: {
      staging: ['dia-stg.atlassian.net'],
      production: ['zenuml.atlassian.net'],
    },
    productType: 'diagramly',
    forgeAppLabelVarName: 'APP_LABEL',
    extraEnv: {
      production: {
        DIAGRAMLY_BACKEND_API_BASE_URL: 'https://diagramly.ai',
      },
    },
  },
  asyncapi: {
    appKey: 'asyncapi',
    appId: '49017727-af19-4ab6-8d5a-7d28108936b6',
    connectKey: 'com.zenuml.confluence-addon-asyncapi',
    sequenceMacroKey: 'zenuml-asyncapi-macro',
    customContentKey: 'zenuml-content-asyncapi',
    liteKeySuffix: '',
    liteTitleSuffix: '',
    appLabel: 'AsyncAPI for Confluence',
    backendUrls: {
      // Shared with the lite Cloudflare Pages projects until a dedicated
      // conf-(stg-)asyncapi project is stood up. Revisit before GA.
      staging: 'https://conf-stg-lite.zenuml.com',
      production: 'https://conf-lite.zenuml.com',
    },
    // AsyncAPI is a single-purpose variant: strip every macro except the
    // AsyncAPI one, and drop the dashboard / get-started / byline modules
    // that don't apply.
    manifestEdits: [
      {
        description: 'Remove licensing (asyncapi MVP is free)',
        yqEvalExpr: 'del(.app.licensing)',
      },
      {
        description: 'Remove non-asyncapi macros (sequence, openapi, graph, embed)',
        yqEvalExpr:
          'del(.modules.macro[] | select(.key | test("zenuml-asyncapi-macro") | not))',
      },
      {
        description: 'Remove globalSettings + globalPage + contentBylineItem',
        yqEvalExpr:
          'del(.modules["confluence:globalSettings"]) | del(.modules["confluence:globalPage"]) | del(.modules["confluence:contentBylineItem"])',
      },
      {
        description: 'Remove non-asyncapi custom content types',
        yqEvalExpr:
          'del(.modules["confluence:customContent"][] | select(.key | test("zenuml-content-asyncapi") | not))',
      },
    ],
    sites: {
      // No dedicated asyncapi staging site yet; reuse lite-stg for early validation.
      staging: ['lite-stg.atlassian.net'],
      production: ['zenuml.atlassian.net'],
    },
    productType: 'asyncapi',
    forgeAppLabelVarName: 'APP_LABEL',
  },
}

export function getAppConfig(appKey) {
  const cfg = APPS[appKey]
  if (!cfg) throw new Error(`Unknown app key: ${appKey}`)
  return cfg
}

export function getManifestEditDescriptions(appKey) {
  return getAppConfig(appKey).manifestEdits.map((e) => e.description)
}

export function getManifestEditYqArgs(appKey) {
  return getAppConfig(appKey).manifestEdits.map((e) => ({ expr: e.yqEvalExpr }))
}

function formatEnvPrefix(envMap) {
  const entries = Object.entries(envMap).filter(([, v]) => v !== undefined && v !== null)
  entries.sort(([a], [b]) => a.localeCompare(b))
  return entries.map(([k, v]) => `${k}=${String(v)}`).join(' ')
}

function toForgeEnvName(environmentChoice, devEnvVars) {
  if (environmentChoice === 'staging') return 'staging'
  if (environmentChoice === 'production') return 'production'
  if (environmentChoice === 'development') {
    const forgeEnv = devEnvVars.FORGE_ENV
    if (!forgeEnv) {
      throw new Error(
        'Missing FORGE_ENV in .env.forge.local. Create it from .env.forge.local.example.',
      )
    }
    return forgeEnv
  }
  throw new Error(`Unknown environmentChoice: ${environmentChoice}`)
}

function parseEnvFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8')
  const vars = {}
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const idx = line.indexOf('=')
    if (idx === -1) continue
    const key = line.slice(0, idx).trim()
    const value = line.slice(idx + 1).trim()
    vars[key] = value
  }
  return vars
}

function resolveBackendApiBaseUrl({ app, environmentChoice, devEnvVars }) {
  if (environmentChoice === 'development') {
    if (devEnvVars.BACKEND_API_BASE_URL) return devEnvVars.BACKEND_API_BASE_URL
    return app.backendUrls.staging
  }
  if (environmentChoice === 'staging') return app.backendUrls.staging
  if (environmentChoice === 'production') return app.backendUrls.production
  throw new Error(`Unknown environmentChoice: ${environmentChoice}`)
}

function resolveKnownSites({ app, environmentChoice, devEnvVars }) {
  if (environmentChoice === 'development') {
    const site = devEnvVars.ATLASSIAN_SITE
    if (!site) {
      throw new Error(
        'Missing ATLASSIAN_SITE in .env.forge.local. Create it from .env.forge.local.example.',
      )
    }
    return [site]
  }
  return environmentChoice === 'staging' ? app.sites.staging : app.sites.production
}

async function runCommandLogged({
  label,
  command,
  args,
  env,
  liveOutput = 'full', // 'full' | 'limited'
  maxLiveChars = 0,
  progressDotsEveryMs = 0,
  maxCaptureChars = 300_000,
}) {
  const envPrefix = env ? formatEnvPrefix(env) : ''
  const fullCmd = `${envPrefix ? envPrefix + ' ' : ''}${command} ${args.join(' ')}`
  console.log(`${label}\n  → ${fullCmd}`)

  const child = spawn(command, args, {
    env: env ? { ...process.env, ...env } : process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  // Live streaming behavior:
  // - capture complete-ish output for error messages
  // - optionally forward only a limited amount to terminal to avoid flooding scrollback
  let capturedStderr = ''
  let capturedStdout = ''
  const MAX_CAPTURE_CHARS = maxCaptureChars
  let livePrintedChars = 0
  let truncationNoticePrinted = false

  let dotsTimer = null
  let lastPrintedWasDot = false
  if (progressDotsEveryMs > 0) {
    dotsTimer = setInterval(() => {
      process.stdout.write('.')
      lastPrintedWasDot = true
    }, progressDotsEveryMs)
  }

  function maybeNewlineBeforeText(stream) {
    // If the spinner has just printed '.', ensure we break the line before any text output.
    if (stream === 'stdout' && lastPrintedWasDot) {
      process.stdout.write('\n')
      lastPrintedWasDot = false
    }
  }

  function maybeForwardChunk({ chunkStr, stream }) {
    if (liveOutput === 'full') {
      maybeNewlineBeforeText(stream)
      if (stream === 'stdout') process.stdout.write(chunkStr)
      else process.stderr.write(chunkStr)
      livePrintedChars += chunkStr.length
      return
    }

    if (liveOutput === 'limited') {
      if (livePrintedChars < maxLiveChars) {
        const remaining = maxLiveChars - livePrintedChars
        const toPrint = chunkStr.slice(0, remaining)
        maybeNewlineBeforeText(stream)
        if (stream === 'stdout') process.stdout.write(toPrint)
        else process.stderr.write(toPrint)
        livePrintedChars += toPrint.length
        return
      }
      if (!truncationNoticePrinted) {
        truncationNoticePrinted = true
        process.stdout.write('\n[output truncated; still running]\n')
        lastPrintedWasDot = false
      }
    }
  }

  child.stdout.on('data', (chunk) => {
    const chunkStr = chunk.toString('utf-8')
    maybeForwardChunk({ chunkStr, stream: 'stdout' })
    if (capturedStdout.length < MAX_CAPTURE_CHARS) {
      capturedStdout += chunkStr
    }
  })

  child.stderr.on('data', (chunk) => {
    const chunkStr = chunk.toString('utf-8')
    maybeForwardChunk({ chunkStr, stream: 'stderr' })
    if (capturedStderr.length < MAX_CAPTURE_CHARS) {
      capturedStderr += chunkStr
    }
  })

  const exitCode = await new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('close', resolve)
  })

  if (dotsTimer) clearInterval(dotsTimer)

  if (exitCode !== 0) {
    console.error(`Command failed (exit ${exitCode}): ${fullCmd}`)
    const combinedOutput = [capturedStderr, capturedStdout].filter((s) => s && s.trim().length > 0).join('\n')
    throw new Error(
      combinedOutput
        ? `Command failed: ${command} ${args.join(' ')}\n${combinedOutput}`
        : `Command failed: ${command} ${args.join(' ')}`,
    )
  }

  return { stdout: capturedStdout, stderr: capturedStderr, exitCode }
}

async function buildApp({ app }) {
  const args = ['exec', 'vite', 'build']
  if (app.buildMode) args.push('--mode', app.buildMode)
  await runCommandLogged({
    label: 'Building',
    command: 'pnpm',
    args,
    env: {
      PRODUCT_TYPE: app.productType,
    },
    liveOutput: 'limited',
    maxLiveChars: 5000,
    progressDotsEveryMs: 1500,
  })
}

async function runTunnel({ appEnvVars, forgeEnv }) {
  const command = 'forge'
  const args = ['tunnel', '-e', forgeEnv]
  const envPrefix = formatEnvPrefix(appEnvVars)
  const fullCmd = `${envPrefix ? envPrefix + ' ' : ''}${command} ${args.join(' ')}`
  console.log(`Start tunnel\n  → ${fullCmd}`)

  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...appEnvVars },
      stdio: 'inherit',
    })
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`forge tunnel exited with code ${code}`))
    })
    child.on('error', reject)
  })
}

function getForgeEnvVarsForApp({ app, backendApiBaseUrl, appEnvironmentChoice, devEnvVars }) {
  const appEnvVars = {
    APP_ID: app.appId,
    CONNECT_KEY: app.connectKey,
    SEQUENCE_MACRO_KEY: app.sequenceMacroKey,
    CUSTOM_CONTENT_KEY: app.customContentKey,
    LITE_KEY_SUFFIX: app.liteKeySuffix,
    LITE_TITLE_SUFFIX: app.liteTitleSuffix,
    APP_LABEL: app.appLabel,
    BACKEND_API_BASE_URL: backendApiBaseUrl,
  }

  if (app.extraEnv?.production && appEnvironmentChoice === 'production') {
    Object.assign(appEnvVars, app.extraEnv.production)
  }

  // Development optional overrides (if present in .env.forge.local)
  if (appEnvironmentChoice === 'development') {
    if (devEnvVars.DIAGRAMLY_BACKEND_API_BASE_URL) {
      appEnvVars.DIAGRAMLY_BACKEND_API_BASE_URL =
        devEnvVars.DIAGRAMLY_BACKEND_API_BASE_URL
    }
  }

  return appEnvVars
}

function ensureManifestRestoredOnce({ manifestPath, backupPath }) {
  return () => {
    if (fs.existsSync(backupPath)) {
      // Restore file contents deterministically.
      fs.copyFileSync(backupPath, manifestPath)
      fs.unlinkSync(backupPath)
    }
  }
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function extractFirstJsonArray(text) {
  if (!text) return null
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start === -1 || end === -1 || end <= start) return null
  const candidate = text.slice(start, end + 1)
  return safeJsonParse(candidate)
}

async function isAppInstalledOnSite({ site, forgeEnv, appEnvVars }) {
  // Forge's `install list` output is a JSON array. We determine whether our app is installed
  // by checking if any entry's `site` matches the requested site.
  const res = await runCommandLogged({
    label: 'Check installed (forge install list)',
    command: 'forge',
    args: ['install', 'list', '--site', site, '--product', 'confluence', '-e', forgeEnv, '--json'],
    env: appEnvVars,
    liveOutput: 'limited',
    maxLiveChars: 2000,
    progressDotsEveryMs: 0,
    maxCaptureChars: 2_000_000,
  })

  const parsed = extractFirstJsonArray(res.stdout)
  if (!Array.isArray(parsed)) {
    throw new Error('Unexpected JSON from `forge install list --json` (expected an array).')
  }

  return parsed.some((entry) => entry && entry.site === site)
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log([
      'Forge wizard (deterministic, command-logging)',
      '',
      'Usage:',
      '  pnpm forge-wizard',
      '',
      'Interactive:',
      '  Select app → select environment → build → deploy → install/upgrade (optional) → tunnel (optional)',
    ].join('\n'))
    return
  }

  const argMap = {}
  for (let i = 0; i < process.argv.length; i++) {
    const a = process.argv[i]
    if (!a.startsWith('--')) continue
    const key = a.replace(/^--/, '')
    const next = process.argv[i + 1]
    if (!next || next.startsWith('--')) {
      argMap[key] = true
    } else {
      argMap[key] = next
      i++
    }
  }

  const nonInteractive = typeof argMap.app === 'string' && typeof argMap.env === 'string'

  const appKey = nonInteractive
    ? String(argMap.app)
    : await select({
        message: 'Select app',
        choices: [
          { name: 'lite', value: 'lite' },
          { name: 'full', value: 'full' },
          { name: 'diagramly', value: 'diagramly' },
          { name: 'asyncapi', value: 'asyncapi' },
        ],
      })

  const app = getAppConfig(appKey)
  const manifestChanges = getManifestEditDescriptions(appKey)

  console.log(`\nApp: ${appKey}`)
  console.log(`  APP_ID: ${app.appId}`)
  if (manifestChanges.length === 0) {
    console.log('  Manifest changes: none')
  } else {
    console.log('  Manifest changes:')
    for (const d of manifestChanges) console.log(`    - ${d}`)
  }

  const environmentChoice = nonInteractive
    ? String(argMap.env)
    : await select({
        message: 'Select environment',
        choices: [
          { name: 'development', value: 'development' },
          { name: 'staging', value: 'staging' },
          { name: 'production', value: 'production' },
        ],
      })

  const devEnvVars =
    environmentChoice === 'development'
      ? parseEnvFile(path.resolve(process.cwd(), '.env.forge.local'))
      : {}

  if (environmentChoice === 'production') {
    const ok = await confirm({
      message: 'You are about to deploy to PRODUCTION. Continue?',
    })
    if (!ok) {
      console.log('Exiting (production deploy canceled).')
      return
    }
  }

  // Build before any Forge deploy to ensure dist/ is fresh.
  console.log('\nBuild step may take ~1 minute. Please wait...')
  await buildApp({ app })

  const forgeEnv = toForgeEnvName(environmentChoice, devEnvVars)
  const backendApiBaseUrl = resolveBackendApiBaseUrl({
    app,
    environmentChoice,
    devEnvVars,
  })

  // Backup manifest.yml before applying yq edits.
  const manifestPath = path.resolve(process.cwd(), 'manifest.yml')
  const backupPath = path.resolve(process.cwd(), 'manifest.yml.bak')
  if (fs.existsSync(backupPath)) {
    throw new Error(
      'manifest.yml.bak already exists. Please remove it (or restore manifest.yml) before running the wizard.',
    )
  }
  console.log(`\nBackup manifest\n  → cp manifest.yml ${path.basename(backupPath)}`)
  fs.copyFileSync(manifestPath, backupPath)

  const restore = ensureManifestRestoredOnce({ manifestPath, backupPath })

  try {
    // Enable analytics (command is app-aware via env var templates).
    const analyticsEnvVars = getForgeEnvVarsForApp({
      app,
      backendApiBaseUrl,
      appEnvironmentChoice: environmentChoice,
      devEnvVars,
    })

    await runCommandLogged({
      label: 'Enable Forge usage analytics',
      command: 'forge',
      args: ['settings', 'set', 'usage-analytics', 'true'],
      env: analyticsEnvVars,
      liveOutput: 'limited',
      maxLiveChars: 2000,
      progressDotsEveryMs: 1000,
    })

    if (app.manifestEdits.length > 0) {
      console.log('\nEditing manifest')
    }
    for (const edit of app.manifestEdits) {
      await runCommandLogged({
        label: edit.description,
        command: 'yq',
        args: ['eval', edit.yqEvalExpr, '-i', manifestPath],
      })
    }

    // Forge deploy always runs before install/tunnel.
    const appEnvVars = getForgeEnvVarsForApp({
      app,
      backendApiBaseUrl,
      appEnvironmentChoice: environmentChoice,
      devEnvVars,
    })
    const deployArgs = ['deploy', '-e', forgeEnv, '--non-interactive']
    await runCommandLogged({
      label: 'Deploy to Forge',
      command: 'forge',
      args: deployArgs,
      env: appEnvVars,
      liveOutput: 'limited',
      maxLiveChars: 12000,
      progressDotsEveryMs: 2000,
    })

    // Site selection only applies to install/upgrade + tunnel.
    console.log('\nSelection context (already chosen):')
    console.log(`  App: ${app.appKey} (APP_ID: ${app.appId})`)
    console.log(`  Environment: ${environmentChoice} (forge -e: ${forgeEnv})`)
    if (manifestChanges.length === 0) {
      console.log('  Manifest changes: none')
    } else {
      console.log('  Manifest changes:')
      for (const d of manifestChanges) console.log(`    - ${d}`)
    }

    const knownSites = resolveKnownSites({ app, environmentChoice, devEnvVars })
    let siteChoice
    if (nonInteractive) {
      const siteArg = String(argMap.site ?? 'none').toLowerCase()
      if (siteArg === 'none') siteChoice = '__none__'
      else if (siteArg === 'custom') siteChoice = '__custom__'
      else siteChoice = String(argMap.site)
    } else {
      siteChoice = await select({
        message: 'Select site for install/upgrade (required for tunnel)',
        choices: [
          ...knownSites.map((s) => ({ name: s, value: s })),
          { name: 'Enter custom site...', value: '__custom__' },
          { name: 'None (skip install)', value: '__none__' },
        ],
      })
    }

    if (siteChoice === '__none__') {
      console.log('\nNo site selected; exiting after deploy.')
      return
    }

    const site =
      siteChoice === '__custom__'
        ? nonInteractive
          ? String(argMap.customSite ?? argMap.site)
          : await input({ message: 'Atlassian site (e.g. xxx.atlassian.net)' })
        : siteChoice

    const installArgs = [
      'install',
      '--site',
      site,
      '--product',
      'confluence',
      '-e',
      forgeEnv,
      '--non-interactive',
    ]
    const upgradeArgs = [
      'install',
      '--upgrade',
      '--site',
      site,
      '--product',
      'confluence',
      '-e',
      forgeEnv,
      '--non-interactive',
    ]

    let installedState = null
    try {
      installedState = await isAppInstalledOnSite({
        site,
        forgeEnv,
        appEnvVars,
      })
    } catch (err) {
      console.warn(
        `Install list check failed; falling back to command-based detection.\nReason: ${String(
          err?.message || err,
        )}`,
      )
    }

    if (installedState === true) {
      await runCommandLogged({
        label: 'Forge upgrade (already installed)',
        command: 'forge',
        args: upgradeArgs,
        env: appEnvVars,
        liveOutput: 'limited',
        maxLiveChars: 12000,
        progressDotsEveryMs: 2000,
      })
    } else if (installedState === false) {
      await runCommandLogged({
        label: 'Forge install',
        command: 'forge',
        args: installArgs,
        env: appEnvVars,
        liveOutput: 'limited',
        maxLiveChars: 12000,
        progressDotsEveryMs: 2000,
      })
    } else {
      // Fallback path: try install; if already installed then upgrade.
      try {
        await runCommandLogged({
          label: 'Forge install',
          command: 'forge',
          args: installArgs,
          env: appEnvVars,
          liveOutput: 'limited',
          maxLiveChars: 12000,
          progressDotsEveryMs: 2000,
        })
      } catch (err) {
        const msg = String(err?.message || '')
        if (!/already installed/i.test(msg)) throw err
        await runCommandLogged({
          label: 'Forge upgrade (already installed)',
          command: 'forge',
          args: upgradeArgs,
          env: appEnvVars,
          liveOutput: 'limited',
          maxLiveChars: 12000,
          progressDotsEveryMs: 2000,
        })
      }
    }

    let startTunnel = false
    if (nonInteractive) {
      const tunnelArg = String(argMap.tunnel ?? 'no').toLowerCase()
      startTunnel = tunnelArg === 'yes' || tunnelArg === 'true'
    } else {
      startTunnel = await confirm({
        message: 'Start forge tunnel?',
        default: false,
      })
    }
    if (startTunnel) await runTunnel({ appEnvVars, forgeEnv })
    else console.log('Tunnel skipped.')
  } finally {
    // Always restore manifest, even when deploy/install fails.
    console.log('\nRestore manifest\n  → mv manifest.yml.bak manifest.yml')
    restore()
  }
}

// Execute only when run directly via node scripts/forge-wizard.mjs
if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}

