import { spawn, ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import path from 'path'
import { fileURLToPath } from 'url'
import type { TunnelStatus } from '../../shared/types.js'

// Get the workspace root (where manifest.yml is located)
// Path from tunnel.ts: forge-console/src/server/services/ -> 4 levels up to confluence-cloud-23/
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const WORKSPACE_ROOT = path.resolve(__dirname, '../../../..')

// Get the full path to forge CLI
const HOME = process.env.HOME || ''
const FORGE_PATH = path.join(HOME, '.volta/bin/forge')

interface TunnelState {
  status: TunnelStatus['status']
  app: string | null
  environment: string | null
  activeEnvVars: Record<string, string> | null
  startedAt: Date | null
  error: string | null
}

interface LogEntry {
  timestamp: string
  level: 'info' | 'warn' | 'error' | 'debug'
  message: string
}

class TunnelManager extends EventEmitter {
  private process: ChildProcess | null = null
  private state: TunnelState = {
    status: 'stopped',
    app: null,
    environment: null,
    activeEnvVars: null,
    startedAt: null,
    error: null
  }
  private logs: LogEntry[] = []
  private maxLogs = 1000

  constructor() {
    super()
  }

  getStatus(): TunnelStatus {
    return {
      status: this.state.status,
      app: this.state.app ?? undefined,
      environment: this.state.environment ?? undefined,
      activeEnvVars: this.state.activeEnvVars ?? undefined,
      startedAt: this.state.startedAt?.toISOString(),
      error: this.state.error ?? undefined
    }
  }

  getLogs(): LogEntry[] {
    return [...this.logs]
  }

  isRunning(): boolean {
    return this.state.status === 'running' || this.state.status === 'starting'
  }

  async start(
    app: string,
    environment: string,
    envVars: Record<string, string>
  ): Promise<{ success: boolean; error?: string }> {
    // Check if already running
    if (this.isRunning()) {
      return {
        success: false,
        error: `Tunnel already running for ${this.state.app}/${this.state.environment}`
      }
    }

    // Reset state
    this.state = {
      status: 'starting',
      app,
      environment,
      activeEnvVars: envVars,
      startedAt: new Date(),
      error: null
    }
    this.logs = []

    this.emit('status', this.getStatus())
    this.addLog('info', `Starting tunnel for ${app} (${environment})...`)

    try {
      // Build the forge tunnel command
      const args = ['tunnel', '-e', environment]

      // Spawn the process with environment variables
      // Run from workspace root where manifest.yml is located
      this.process = spawn(FORGE_PATH, args, {
        shell: '/bin/zsh',
        env: {
          ...process.env,
          ...envVars
        },
        cwd: WORKSPACE_ROOT
      })

      // Handle stdout
      this.process.stdout?.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n').filter(line => line.trim())
        for (const line of lines) {
          this.parseAndAddLog(line)
        }
      })

      // Handle stderr
      this.process.stderr?.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n').filter(line => line.trim())
        for (const line of lines) {
          // Forge outputs progress and info to stderr
          this.parseAndAddLog(line)
        }
      })

      // Handle process exit
      this.process.on('close', (code) => {
        if (code === 0) {
          this.addLog('info', 'Tunnel stopped gracefully')
        } else if (code !== null) {
          this.addLog('error', `Tunnel exited with code ${code}`)
          this.state.error = `Process exited with code ${code}`
        }
        this.state.status = 'stopped'
        this.process = null
        this.emit('status', this.getStatus())
      })

      // Handle process error
      this.process.on('error', (err) => {
        this.addLog('error', `Failed to start tunnel: ${err.message}`)
        this.state.status = 'error'
        this.state.error = err.message
        this.process = null
        this.emit('status', this.getStatus())
      })

      // Wait a bit to check if process started successfully
      await new Promise(resolve => setTimeout(resolve, 2000))

      if (this.process && !this.process.killed) {
        this.state.status = 'running'
        this.addLog('info', 'Tunnel started successfully')
        this.emit('status', this.getStatus())
        return { success: true }
      } else if (this.state.error) {
        return { success: false, error: this.state.error }
      } else {
        return { success: false, error: 'Tunnel process terminated unexpectedly' }
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error'
      this.state.status = 'error'
      this.state.error = error
      this.addLog('error', `Failed to start tunnel: ${error}`)
      this.emit('status', this.getStatus())
      return { success: false, error }
    }
  }

  async stop(): Promise<{ success: boolean; error?: string }> {
    if (!this.process) {
      this.state.status = 'stopped'
      return { success: true }
    }

    this.addLog('info', 'Stopping tunnel...')

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        // Force kill if graceful shutdown takes too long
        if (this.process) {
          this.addLog('warn', 'Force killing tunnel process...')
          this.process.kill('SIGKILL')
        }
      }, 5000)

      this.process?.once('close', () => {
        clearTimeout(timeout)
        this.state.status = 'stopped'
        this.process = null
        this.emit('status', this.getStatus())
        resolve({ success: true })
      })

      // Try graceful shutdown first
      this.process?.kill('SIGTERM')
    })
  }

  private addLog(level: LogEntry['level'], message: string) {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message
    }
    this.logs.push(entry)

    // Trim logs if too many
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs)
    }

    this.emit('log', entry)
  }

  private parseAndAddLog(line: string) {
    // Detect log level from content
    let level: LogEntry['level'] = 'info'
    const lowerLine = line.toLowerCase()

    if (lowerLine.includes('error') || lowerLine.includes('fail')) {
      level = 'error'
    } else if (lowerLine.includes('warn')) {
      level = 'warn'
    } else if (lowerLine.includes('debug')) {
      level = 'debug'
    }

    // Check for tunnel connected message
    if (lowerLine.includes('listening') || lowerLine.includes('tunnel ready') || lowerLine.includes('connected')) {
      this.state.status = 'running'
      this.emit('status', this.getStatus())
    }

    this.addLog(level, line)
  }
}

// Singleton instance
export const tunnelManager = new TunnelManager()
