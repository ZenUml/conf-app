import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { AppInfo, MergedEnvVars, WhoAmIResponse, TunnelStatus, Deployment, Installation } from '../../shared/types'

interface LogEntry {
  timestamp: string
  level: 'info' | 'warn' | 'error' | 'debug'
  message: string
}

interface DeploymentsData {
  appId: string
  deployments: Deployment[]
  command?: string
}

interface InstallationsData {
  appId: string
  installations: Installation[]
  command?: string
}

interface EnvironmentInfo {
  name: string
  type: string
  canTunnel: boolean
}

export const useConsoleStore = defineStore('console', () => {
  // State
  const apps = ref<AppInfo[]>([])
  const defaultApp = ref<string>('')
  const currentAppId = ref<string>('')
  const currentEnvironment = ref<string>('')
  const envVars = ref<MergedEnvVars | null>(null)
  const whoami = ref<WhoAmIResponse | null>(null)
  const tunnelStatus = ref<TunnelStatus>({ status: 'stopped' })
  const tunnelLogs = ref<LogEntry[]>([])
  const deployments = ref<DeploymentsData | null>(null)
  const installations = ref<InstallationsData | null>(null)
  const environments = ref<EnvironmentInfo[]>([])
  const loading = ref({
    apps: false,
    envVars: false,
    whoami: false,
    tunnel: false,
    deployments: false,
    installations: false,
    environments: false,
    install: false,
    uninstall: false
  })
  const error = ref<string | null>(null)

  // SSE connection
  let eventSource: EventSource | null = null

  // Computed
  const currentApp = computed(() =>
    apps.value.find(app => app.id === currentAppId.value) ?? null
  )

  const availableEnvironments = computed(() =>
    environments.value.map(e => e.name)
  )

  const isLoggedIn = computed(() => whoami.value?.loggedIn ?? false)

  const isTunnelRunning = computed(() =>
    tunnelStatus.value.status === 'running' || tunnelStatus.value.status === 'starting'
  )

  const canStartTunnel = computed(() => {
    if (!isLoggedIn.value) return false
    if (!envVars.value) return false
    if (isTunnelRunning.value) return false
    // Check if environment supports tunnel
    const envInfo = environments.value.find(e => e.name === currentEnvironment.value)
    return envInfo?.canTunnel ?? false
  })

  // Actions
  async function fetchWhoami() {
    loading.value.whoami = true
    try {
      const response = await fetch('/api/whoami')
      whoami.value = await response.json()
    } catch (e) {
      error.value = 'Failed to check login status'
    } finally {
      loading.value.whoami = false
    }
  }

  async function fetchApps() {
    loading.value.apps = true
    try {
      const response = await fetch('/api/apps')
      const data = await response.json()
      if (data.success) {
        apps.value = data.data.apps
        defaultApp.value = data.data.defaultApp

        // Set current app if not set
        if (!currentAppId.value && defaultApp.value) {
          currentAppId.value = defaultApp.value
        }
      } else {
        error.value = data.error
      }
    } catch (e) {
      error.value = 'Failed to load apps'
    } finally {
      loading.value.apps = false
    }
  }

  async function fetchEnvironments() {
    if (!currentAppId.value) {
      environments.value = []
      return
    }

    loading.value.environments = true
    try {
      const response = await fetch(`/api/apps/${currentAppId.value}/environments`)
      const data = await response.json()
      if (data.success) {
        environments.value = data.data.environments
        // Set default environment if not set
        if (!currentEnvironment.value && environments.value.length > 0) {
          const devEnv = environments.value.find(e => e.name === 'development')
          currentEnvironment.value = devEnv ? devEnv.name : environments.value[0].name
        }
      } else {
        environments.value = []
      }
    } catch (e) {
      environments.value = []
    } finally {
      loading.value.environments = false
    }
  }

  async function fetchEnvVars() {
    if (!currentAppId.value || !currentEnvironment.value) {
      envVars.value = null
      return
    }

    loading.value.envVars = true
    try {
      const response = await fetch(`/api/apps/${currentAppId.value}/envvars/${currentEnvironment.value}`)
      const data = await response.json()
      if (data.success) {
        envVars.value = data.data
      } else {
        error.value = data.error
        envVars.value = null
      }
    } catch (e) {
      error.value = 'Failed to load environment variables'
      envVars.value = null
    } finally {
      loading.value.envVars = false
    }
  }

  async function fetchTunnelStatus() {
    try {
      const response = await fetch('/api/tunnel/status')
      const data = await response.json()
      if (data.success) {
        tunnelStatus.value = data.data
      }
    } catch (e) {
      // Ignore errors
    }
  }

  async function fetchDeployments() {
    if (!currentAppId.value) {
      deployments.value = null
      return
    }

    loading.value.deployments = true
    try {
      const response = await fetch(`/api/apps/${currentAppId.value}/deployments`)
      const data = await response.json()
      if (data.success) {
        deployments.value = data.data
      } else {
        deployments.value = null
      }
    } catch (e) {
      deployments.value = null
    } finally {
      loading.value.deployments = false
    }
  }

  async function fetchInstallations() {
    if (!currentAppId.value) {
      installations.value = null
      return
    }

    loading.value.installations = true
    try {
      const response = await fetch(`/api/apps/${currentAppId.value}/installations`)
      const data = await response.json()
      if (data.success) {
        installations.value = data.data
      } else {
        installations.value = null
      }
    } catch (e) {
      installations.value = null
    } finally {
      loading.value.installations = false
    }
  }

  async function setApp(appId: string) {
    currentAppId.value = appId
    currentEnvironment.value = ''

    // Fetch environments from Forge CLI for this app
    await fetchEnvironments()

    // Fetch new env vars, deployments, and installations
    fetchEnvVars()
    fetchDeployments()
    fetchInstallations()
  }

  function setEnvironment(env: string) {
    currentEnvironment.value = env
    fetchEnvVars()
  }

  async function startTunnel(): Promise<{ success: boolean; error?: string }> {
    if (!currentAppId.value || !currentEnvironment.value) {
      return { success: false, error: 'No app or environment selected' }
    }

    loading.value.tunnel = true
    error.value = null
    tunnelLogs.value = []

    try {
      const response = await fetch('/api/tunnel/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appId: currentAppId.value,
          environment: currentEnvironment.value
        })
      })

      const data = await response.json()

      if (data.success) {
        tunnelStatus.value = data.data
        // Connect to SSE for logs
        connectToLogStream()
        return { success: true }
      } else {
        error.value = data.error
        return { success: false, error: data.error }
      }
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : 'Failed to start tunnel'
      error.value = errorMsg
      return { success: false, error: errorMsg }
    } finally {
      loading.value.tunnel = false
    }
  }

  async function stopTunnel(): Promise<{ success: boolean; error?: string }> {
    loading.value.tunnel = true

    try {
      const response = await fetch('/api/tunnel/stop', {
        method: 'POST'
      })

      const data = await response.json()

      if (data.success) {
        tunnelStatus.value = data.data
        // Disconnect SSE
        disconnectLogStream()
        return { success: true }
      } else {
        error.value = data.error
        return { success: false, error: data.error }
      }
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : 'Failed to stop tunnel'
      error.value = errorMsg
      return { success: false, error: errorMsg }
    } finally {
      loading.value.tunnel = false
    }
  }

  function connectToLogStream() {
    // Disconnect existing connection
    disconnectLogStream()

    // Connect to SSE endpoint
    eventSource = new EventSource('/api/tunnel/logs/stream')

    eventSource.addEventListener('log', (event) => {
      const log = JSON.parse(event.data) as LogEntry
      tunnelLogs.value.push(log)
      // Keep last 1000 logs
      if (tunnelLogs.value.length > 1000) {
        tunnelLogs.value = tunnelLogs.value.slice(-1000)
      }
    })

    eventSource.addEventListener('status', (event) => {
      tunnelStatus.value = JSON.parse(event.data) as TunnelStatus
    })

    eventSource.onerror = () => {
      // Reconnect on error if tunnel is still running
      if (isTunnelRunning.value) {
        setTimeout(connectToLogStream, 2000)
      }
    }
  }

  function disconnectLogStream() {
    if (eventSource) {
      eventSource.close()
      eventSource = null
    }
  }

  function clearLogs() {
    tunnelLogs.value = []
  }

  async function installApp(site: string): Promise<{ success: boolean; command?: string; output?: string; error?: string }> {
    if (!currentAppId.value || !currentEnvironment.value) {
      return { success: false, error: 'No app or environment selected' }
    }

    loading.value.install = true
    error.value = null

    try {
      const response = await fetch(`/api/apps/${currentAppId.value}/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          site,
          environment: currentEnvironment.value
        })
      })

      const data = await response.json()

      if (data.success) {
        // Refresh installations list
        fetchInstallations()
        return { success: true, command: data.data.command, output: data.data.output }
      } else {
        error.value = data.error
        return { success: false, command: data.command, error: data.error }
      }
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : 'Failed to install app'
      error.value = errorMsg
      return { success: false, error: errorMsg }
    } finally {
      loading.value.install = false
    }
  }

  async function uninstallApp(site: string, environment: string): Promise<{ success: boolean; command?: string; output?: string; error?: string }> {
    if (!currentAppId.value) {
      return { success: false, error: 'No app selected' }
    }

    loading.value.uninstall = true
    error.value = null

    try {
      const response = await fetch(`/api/apps/${currentAppId.value}/uninstall`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site, environment })
      })

      const data = await response.json()

      if (data.success) {
        // Refresh installations list
        fetchInstallations()
        return { success: true, command: data.data.command, output: data.data.output }
      } else {
        error.value = data.error
        return { success: false, command: data.command, error: data.error }
      }
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : 'Failed to uninstall app'
      error.value = errorMsg
      return { success: false, error: errorMsg }
    } finally {
      loading.value.uninstall = false
    }
  }

  async function initialize() {
    await Promise.all([
      fetchWhoami(),
      fetchApps(),
      fetchTunnelStatus()
    ])

    // Fetch environments from Forge CLI
    await fetchEnvironments()
    await fetchEnvVars()

    // Fetch deployments and installations in background
    fetchDeployments()
    fetchInstallations()

    // Connect to log stream if tunnel is already running
    if (isTunnelRunning.value) {
      connectToLogStream()
    }
  }

  return {
    // State
    apps,
    defaultApp,
    currentAppId,
    currentEnvironment,
    envVars,
    whoami,
    tunnelStatus,
    tunnelLogs,
    deployments,
    installations,
    environments,
    loading,
    error,
    // Computed
    currentApp,
    availableEnvironments,
    isLoggedIn,
    isTunnelRunning,
    canStartTunnel,
    // Actions
    fetchWhoami,
    fetchApps,
    fetchEnvironments,
    fetchEnvVars,
    fetchTunnelStatus,
    fetchDeployments,
    fetchInstallations,
    setApp,
    setEnvironment,
    startTunnel,
    stopTunnel,
    installApp,
    uninstallApp,
    clearLogs,
    initialize
  }
})
