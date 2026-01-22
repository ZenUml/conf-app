import { spawn, SpawnOptions } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import os from 'os'
import type { WhoAmIResponse, Deployment, Installation, ForgeEnvironment } from '../../shared/types.js'

// Get the workspace root (where manifest.yml is located)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const WORKSPACE_ROOT = path.resolve(__dirname, '../../../..')

// Get the full path to forge CLI
const HOME = process.env.HOME || ''
const FORGE_PATH = path.join(HOME, '.volta/bin/forge')

interface CommandResult {
  code: number
  stdout: string
  stderr: string
}

/**
 * Execute a command and return the result
 */
export function execCommand(
  command: string,
  args: string[],
  options: SpawnOptions = {}
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      shell: '/bin/zsh',
      env: { ...process.env, ...options.env },
      ...options
    })

    let stdout = ''
    let stderr = ''

    proc.stdout?.on('data', (data) => {
      stdout += data.toString()
    })

    proc.stderr?.on('data', (data) => {
      stderr += data.toString()
    })

    proc.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr })
    })

    proc.on('error', (err) => {
      resolve({ code: 1, stdout: '', stderr: err.message })
    })
  })
}

/**
 * Check if Forge CLI is logged in
 */
export async function whoami(): Promise<WhoAmIResponse> {
  const result = await execCommand(FORGE_PATH, ['whoami'])

  // Combine stdout and stderr since forge outputs to both
  const output = (result.stdout + result.stderr).trim()

  // Parse output - look for "Logged in as" pattern
  // Format: "Logged in as Name (email@example.com)" or "Logged in as: email@example.com"
  const matchWithParens = output.match(/Logged in as\s+(.+?)\s*\(([^)]+)\)/i)
  if (matchWithParens) {
    return { loggedIn: true, email: matchWithParens[2].trim() }
  }

  const matchWithColon = output.match(/Logged in as:?\s+(\S+@\S+)/i)
  if (matchWithColon) {
    return { loggedIn: true, email: matchWithColon[1].trim() }
  }

  // Check if output contains "Logged in as" at all
  if (output.toLowerCase().includes('logged in as')) {
    // Try to extract just the email
    const emailMatch = output.match(/([^\s<>()]+@[^\s<>()]+)/i)
    if (emailMatch) {
      return { loggedIn: true, email: emailMatch[1].trim() }
    }
    return { loggedIn: true, email: 'Unknown user' }
  }

  return { loggedIn: false, error: output || 'Not logged in' }
}

/**
 * Build command string for display purposes
 */
function buildCommandString(envVars: Record<string, string>, args: string[]): string {
  const envVarStr = Object.entries(envVars)
    .filter(([key]) => key === 'APP_ID') // Only show APP_ID for brevity
    .map(([key, value]) => `${key}="${value}"`)
    .join(' ')
  return `cd ${WORKSPACE_ROOT} && ${envVarStr} ${FORGE_PATH} ${args.join(' ')}`
}

/**
 * Get deployment list for the current app
 */
export async function getDeployments(envVars: Record<string, string>): Promise<{ success: boolean; deployments?: Deployment[]; command?: string; error?: string }> {
  const args = ['deploy', 'list', '--json']
  const command = buildCommandString(envVars, args)

  const result = await execCommand(FORGE_PATH, args, {
    env: envVars,
    cwd: WORKSPACE_ROOT
  })

  if (result.code !== 0) {
    return { success: false, command, error: result.stderr || 'Failed to get deployments' }
  }

  try {
    // Parse JSON output from forge deploy list --json
    // The output format is typically an array of deployment objects
    const output = result.stdout.trim()
    if (!output) {
      return { success: true, deployments: [], command }
    }

    // Find the JSON array in the output (skip any non-JSON lines)
    const jsonMatch = output.match(/\[[\s\S]*\]/)
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[0])
      const deployments: Deployment[] = data.map((d: Record<string, unknown>) => {
        // Map environmentKey to environment name
        // Forge uses "default" as the key for the development environment
        let envKey = String(d.environmentKey || d.environment || 'unknown')
        if (envKey === 'default') {
          envKey = 'development'
        }
        return {
          environment: envKey,
          version: String(d.majorVersion || d.version || 'unknown'),
          deployedAt: String(d.createdAt || d.deployedAt || new Date().toISOString()),
          deployedBy: d.createdBy ? String(d.createdBy) : undefined
        }
      })
      return { success: true, deployments, command }
    }

    return { success: true, deployments: [], command }
  } catch (e) {
    return { success: false, command, error: `Failed to parse deployment list: ${e instanceof Error ? e.message : 'Unknown error'}` }
  }
}

/**
 * Get installation list
 */
export async function getInstallations(envVars: Record<string, string>): Promise<{ success: boolean; installations?: Installation[]; command?: string; error?: string }> {
  const args = ['install', 'list']
  const command = buildCommandString(envVars, args)

  const result = await execCommand(FORGE_PATH, args, {
    env: envVars,
    cwd: WORKSPACE_ROOT
  })

  if (result.code !== 0) {
    return { success: false, command, error: result.stderr || 'Failed to get installations' }
  }

  try {
    // Parse table output from forge install list
    // Output is a formatted table with columns: Installation ID | Environment | Site | Atlassian apps | Major Version
    // Strip ANSI color codes
    const cleanOutput = result.stdout.replace(/\x1b\[[0-9;]*m/g, '')
    const lines = cleanOutput.split('\n')
    const installations: Installation[] = []

    for (const line of lines) {
      // Skip header, separator, and empty lines
      if (line.includes('Installation ID') || line.includes('───') || !line.includes('│')) {
        continue
      }

      // Parse table row: │ Installation ID │ Environment │ Site │ Atlassian apps │ Major Version │
      const parts = line.split('│').map(p => p.trim()).filter(p => p)
      if (parts.length >= 4) {
        const [, environment, site, product] = parts
        if (site && !site.includes('Site')) {
          installations.push({
            site: site,
            product: product || 'unknown',
            environment: environment || 'unknown'
          })
        }
      }
    }

    return { success: true, installations, command }
  } catch (e) {
    return { success: false, command, error: `Failed to parse installation list: ${e instanceof Error ? e.message : 'Unknown error'}` }
  }
}

/**
 * Get environments list from Forge CLI
 */
export async function getForgeEnvironments(): Promise<{ success: boolean; environments?: ForgeEnvironment[]; error?: string }> {
  const result = await execCommand(FORGE_PATH, ['environments', 'list'], {
    cwd: WORKSPACE_ROOT
  })

  if (result.code !== 0) {
    return { success: false, error: result.stderr || 'Failed to get environments' }
  }

  try {
    // Parse table output from forge environments list
    // Output format: │ Environment ID │ Type │ Name │ Last deployed at │
    // Strip ANSI color codes
    const cleanOutput = result.stdout.replace(/\x1b\[[0-9;]*m/g, '')
    const lines = cleanOutput.split('\n')
    const environments: ForgeEnvironment[] = []

    for (const line of lines) {
      // Skip header, separator, and empty lines
      if (line.includes('Environment ID') || line.includes('───') || !line.includes('│')) {
        continue
      }

      // Parse table row: │ Environment ID │ Type │ Name │ Last deployed at │
      // Don't filter empty strings to preserve column positions
      const parts = line.split('│').map(p => p.trim())
      // parts[0] = '' (before first │)
      // parts[1] = Environment ID
      // parts[2] = Type (can be empty for custom environments)
      // parts[3] = Name
      // parts[4] = Last deployed at
      if (parts.length >= 4) {
        const envType = parts[2]
        const envName = parts[3]
        if (envName && !envName.includes('Name')) {
          const type = (envType || '').toLowerCase().trim()
          // Development environments can tunnel, staging/production cannot
          const canTunnel = type === 'development' || type === ''
          environments.push({
            name: envName,
            type: type === 'production' ? 'production' : type === 'staging' ? 'staging' : 'development',
            canTunnel
          })
        }
      }
    }

    return { success: true, environments }
  } catch (e) {
    return { success: false, error: `Failed to parse environments list: ${e instanceof Error ? e.message : 'Unknown error'}` }
  }
}

/**
 * Install app to a site
 */
export async function installApp(
  envVars: Record<string, string>,
  site: string,
  environment: string
): Promise<{ success: boolean; command: string; output?: string; error?: string }> {
  const args = ['install', '--site', site, '--product', 'confluence', '-e', environment, '--non-interactive']
  const command = buildCommandString(envVars, args)

  const result = await execCommand(FORGE_PATH, args, {
    env: envVars,
    cwd: WORKSPACE_ROOT
  })

  if (result.code !== 0) {
    return { success: false, command, error: result.stderr || 'Failed to install app' }
  }

  return { success: true, command, output: result.stdout }
}

/**
 * Uninstall app from a site
 * Note: forge uninstall doesn't support --non-interactive, so we use expect to handle the interactive prompt
 */
export async function uninstallApp(
  envVars: Record<string, string>,
  site: string,
  environment: string
): Promise<{ success: boolean; command: string; output?: string; error?: string }> {
  const forgeArgs = ['uninstall', '--site', site, '-e', environment]
  const command = buildCommandString(envVars, forgeArgs)

  // Build the expect script to handle the interactive prompt
  // Write to a temp file to avoid shell escaping issues
  const expectScript = `#!/usr/bin/expect -f
set timeout 60
spawn ${FORGE_PATH} uninstall --site ${site} -e ${environment}
expect {
    "Select where to uninstall" { send "\\r"; exp_continue }
    "Are you sure" { send "y\\r"; exp_continue }
    "Uninstalled" { }
    timeout { exit 1 }
    eof
}
`

  // Write expect script to temp file
  const tempFile = path.join(os.tmpdir(), `forge-uninstall-${Date.now()}.exp`)
  fs.writeFileSync(tempFile, expectScript, { mode: 0o755 })

  try {
    const result = await execCommand('expect', [tempFile], {
      env: envVars,
      cwd: WORKSPACE_ROOT
    })

    // Check if output contains "Uninstalled" to determine success
    const output = result.stdout + result.stderr
    if (output.includes('Uninstalled')) {
      return { success: true, command, output: result.stdout }
    }

    if (result.code !== 0) {
      // Filter out the deprecation warning from the error message
      const cleanError = result.stderr
        .replace(/\(node:\d+\) \[DEP\d+\] DeprecationWarning:.*\n?/g, '')
        .replace(/\(Use `node --trace-deprecation.*\n?/g, '')
        .replace(/Warning: Your version of Forge CLI.*\n?/g, '')
        .replace(/Run npm install.*\n?/g, '')
        .trim()
      return { success: false, command, error: cleanError || 'Failed to uninstall app' }
    }

    return { success: true, command, output: result.stdout }
  } finally {
    // Clean up temp file
    try {
      fs.unlinkSync(tempFile)
    } catch {
      // Ignore cleanup errors
    }
  }
}
