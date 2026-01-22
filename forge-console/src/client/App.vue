<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed, nextTick, watch } from 'vue'
import { useConsoleStore } from './stores/console'

const store = useConsoleStore()
const logContainer = ref<HTMLElement | null>(null)
const autoScroll = ref(true)
const sidebarTab = ref<'envvars' | 'deployments' | 'installations'>('envvars')
const darkMode = ref(false)
const showLoginBanner = ref(true)

// Filter deployments by current environment
const filteredDeployments = computed(() => {
  if (!store.deployments?.deployments) return []
  if (!store.currentEnvironment) return store.deployments.deployments
  return store.deployments.deployments.filter(
    d => d.environment === store.currentEnvironment
  )
})

// Filter installations by current environment
const filteredInstallations = computed(() => {
  if (!store.installations?.installations) return []
  if (!store.currentEnvironment) return store.installations.installations
  return store.installations.installations.filter(
    i => i.environment === store.currentEnvironment
  )
})

// LocalStorage keys
const STORAGE_KEYS = {
  appId: 'forge-console-app-id',
  environment: 'forge-console-environment',
  darkMode: 'forge-console-dark-mode'
}

// Load preferences from localStorage
function loadPreferences() {
  const savedAppId = localStorage.getItem(STORAGE_KEYS.appId)
  const savedEnv = localStorage.getItem(STORAGE_KEYS.environment)
  const savedDarkMode = localStorage.getItem(STORAGE_KEYS.darkMode)

  if (savedDarkMode !== null) {
    darkMode.value = savedDarkMode === 'true'
    updateDarkMode()
  } else {
    // Check system preference
    darkMode.value = window.matchMedia('(prefers-color-scheme: dark)').matches
    updateDarkMode()
  }

  return { savedAppId, savedEnv }
}

// Save preferences to localStorage
function savePreferences() {
  if (store.currentAppId) {
    localStorage.setItem(STORAGE_KEYS.appId, store.currentAppId)
  }
  if (store.currentEnvironment) {
    localStorage.setItem(STORAGE_KEYS.environment, store.currentEnvironment)
  }
}

// Update dark mode class on document
function updateDarkMode() {
  if (darkMode.value) {
    document.documentElement.classList.add('dark')
  } else {
    document.documentElement.classList.remove('dark')
  }
  localStorage.setItem(STORAGE_KEYS.darkMode, String(darkMode.value))
}

// Toggle dark mode
function toggleDarkMode() {
  darkMode.value = !darkMode.value
  updateDarkMode()
}

// Keyboard shortcuts
function handleKeydown(e: KeyboardEvent) {
  // Ctrl+S or Cmd+S to start tunnel
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault()
    if (store.canStartTunnel && !store.loading.tunnel) {
      handleStartTunnel()
    }
  }
  // Ctrl+Q or Cmd+Q to stop tunnel
  if ((e.ctrlKey || e.metaKey) && e.key === 'q') {
    e.preventDefault()
    if (store.isTunnelRunning && !store.loading.tunnel) {
      handleStopTunnel()
    }
  }
}

onMounted(async () => {
  const { savedAppId, savedEnv } = loadPreferences()

  // Add keyboard listener
  window.addEventListener('keydown', handleKeydown)

  // Initialize store
  await store.initialize()

  // Restore saved app/environment after initialization
  if (savedAppId && store.apps.some(a => a.id === savedAppId)) {
    store.setApp(savedAppId)
    if (savedEnv && store.availableEnvironments.includes(savedEnv)) {
      store.setEnvironment(savedEnv)
    }
  }
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
})

// Watch for app/environment changes to save preferences
watch(() => [store.currentAppId, store.currentEnvironment], () => {
  savePreferences()
})

// Auto-scroll logs
function scrollToBottom() {
  if (autoScroll.value && logContainer.value) {
    nextTick(() => {
      logContainer.value!.scrollTop = logContainer.value!.scrollHeight
    })
  }
}

// Watch for new logs and scroll
const logsLength = computed(() => store.tunnelLogs.length)

// Format timestamp
function formatTime(timestamp: string): string {
  const date = new Date(timestamp)
  return date.toLocaleTimeString('en-US', { hour12: false })
}

// Get log level class
function getLogLevelClass(level: string): string {
  switch (level) {
    case 'error': return 'text-red-600 dark:text-red-400'
    case 'warn': return 'text-yellow-600 dark:text-yellow-500'
    case 'debug': return 'text-gray-400'
    default: return 'text-blue-600 dark:text-blue-400'
  }
}

// Tunnel uptime
const tunnelUptime = computed(() => {
  if (!store.tunnelStatus.startedAt) return null
  const start = new Date(store.tunnelStatus.startedAt)
  const now = new Date()
  const diff = Math.floor((now.getTime() - start.getTime()) / 1000)

  const hours = Math.floor(diff / 3600)
  const minutes = Math.floor((diff % 3600) / 60)
  const seconds = diff % 60

  if (hours > 0) {
    return `${hours}h ${minutes}m`
  } else if (minutes > 0) {
    return `${minutes}m ${seconds}s`
  } else {
    return `${seconds}s`
  }
})

// Start tunnel
async function handleStartTunnel() {
  const result = await store.startTunnel()
  if (result.success) {
    scrollToBottom()
  }
}

// Stop tunnel
async function handleStopTunnel() {
  await store.stopTunnel()
}

// Format date for deployments
function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr)
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  } catch {
    return dateStr
  }
}

// Copy text to clipboard
function copyToClipboard(text: string | undefined) {
  if (!text) return
  navigator.clipboard.writeText(text).then(() => {
    // Could add a toast notification here
  }).catch(err => {
    console.error('Failed to copy:', err)
  })
}
</script>

<template>
  <div class="h-screen flex flex-col">
    <!-- Header -->
    <header class="flex shrink-0 items-center gap-4 border-b border-solid border-[#dbe0e6] dark:border-[#22303e] bg-white dark:bg-[#1a2632] px-6 h-16 z-20 shadow-sm">
      <div class="flex items-center gap-3 shrink-0">
        <div class="size-8 flex items-center justify-center text-primary bg-primary/10 rounded-lg">
          <span class="material-symbols-outlined">terminal</span>
        </div>
        <h2 class="text-lg font-bold leading-tight tracking-[-0.015em] hidden md:block">Forge Console</h2>
      </div>

      <div class="w-px h-6 bg-gray-200 dark:bg-gray-700 hidden md:block"></div>

      <!-- App Selector -->
      <div class="flex items-center gap-3">
        <div class="relative">
          <div class="absolute left-3 top-2.5 pointer-events-none text-[#617589]">
            <span class="material-symbols-outlined text-[20px]">apps</span>
          </div>
          <select
            :value="store.currentAppId"
            @change="store.setApp(($event.target as HTMLSelectElement).value)"
            class="h-10 rounded-lg border border-[#dbe0e6] dark:border-[#344155] bg-background-light dark:bg-[#101922] pl-10 pr-8 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all appearance-none cursor-pointer hover:border-gray-400"
            :disabled="store.loading.apps || store.isTunnelRunning"
          >
            <option v-for="app in store.apps" :key="app.id" :value="app.id">
              {{ app.name }}
            </option>
          </select>
          <div class="absolute right-3 top-2.5 pointer-events-none text-[#617589]">
            <span class="material-symbols-outlined text-[20px]">expand_more</span>
          </div>
        </div>

        <!-- Environment Selector -->
        <div class="relative">
          <div class="absolute left-3 top-2.5 pointer-events-none text-[#617589]">
            <span class="material-symbols-outlined text-[20px]">dns</span>
          </div>
          <select
            :value="store.currentEnvironment"
            @change="store.setEnvironment(($event.target as HTMLSelectElement).value)"
            class="h-10 rounded-lg border border-[#dbe0e6] dark:border-[#344155] bg-background-light dark:bg-[#101922] pl-10 pr-8 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all appearance-none cursor-pointer hover:border-gray-400"
            :disabled="store.loading.apps || store.isTunnelRunning"
          >
            <option v-for="env in store.availableEnvironments" :key="env" :value="env">
              {{ env }}
            </option>
          </select>
          <div class="absolute right-3 top-2.5 pointer-events-none text-[#617589]">
            <span class="material-symbols-outlined text-[20px]">expand_more</span>
          </div>
        </div>
      </div>

      <!-- Tunnel Status Badge -->
      <div v-if="store.isTunnelRunning" class="hidden sm:flex h-8 items-center gap-x-2 rounded-full bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 px-3">
        <span class="relative flex h-2.5 w-2.5">
          <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
          <span class="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
        </span>
        <span class="text-green-700 dark:text-green-400 text-xs font-bold uppercase tracking-wide">Running</span>
        <span v-if="tunnelUptime" class="text-green-600 dark:text-green-500 text-xs">{{ tunnelUptime }}</span>
      </div>

      <!-- Spacer -->
      <div class="flex-1"></div>

      <!-- Tunnel Control Button -->
      <button
        v-if="store.isTunnelRunning"
        @click="handleStopTunnel"
        :disabled="store.loading.tunnel"
        class="h-10 bg-red-600 hover:bg-red-700 text-white px-5 rounded-lg font-medium shadow-sm transition-all flex items-center gap-2 text-sm whitespace-nowrap disabled:opacity-50"
      >
        <span v-if="store.loading.tunnel" class="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
        <span v-else class="material-symbols-outlined">stop_circle</span>
        Stop Tunnel
      </button>
      <button
        v-else
        @click="handleStartTunnel"
        :disabled="!store.canStartTunnel || store.loading.tunnel"
        class="h-10 bg-primary hover:bg-primary/90 text-white px-5 rounded-lg font-medium shadow-sm transition-all flex items-center gap-2 text-sm whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <span v-if="store.loading.tunnel" class="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
        <span v-else class="material-symbols-outlined">play_arrow</span>
        Start Tunnel
      </button>

      <div class="w-px h-6 bg-gray-200 dark:bg-gray-700"></div>

      <!-- Login Status -->
      <div v-if="store.loading.whoami" class="flex items-center gap-2 text-sm text-gray-500">
        <span class="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
      </div>
      <div v-else-if="store.whoami?.loggedIn" class="flex items-center gap-2 text-sm text-green-600" :title="store.whoami.email">
        <span class="material-symbols-outlined text-[18px]">check_circle</span>
        <span class="hidden lg:inline max-w-[150px] truncate">{{ store.whoami.email }}</span>
      </div>
      <div v-else class="flex items-center gap-2 text-sm text-yellow-600">
        <span class="material-symbols-outlined text-[18px]">warning</span>
        <span class="hidden sm:inline">Not logged in</span>
      </div>

      <!-- Dark Mode Toggle -->
      <button
        @click="toggleDarkMode"
        class="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-[#22303e] text-[#617589] transition-colors"
        :title="darkMode ? 'Switch to light mode' : 'Switch to dark mode'"
      >
        <span v-if="darkMode" class="material-symbols-outlined text-[20px]">light_mode</span>
        <span v-else class="material-symbols-outlined text-[20px]">dark_mode</span>
      </button>
    </header>

    <!-- Not Logged In Warning Banner -->
    <div
      v-if="!store.loading.whoami && !store.whoami?.loggedIn && showLoginBanner"
      class="bg-yellow-50 dark:bg-yellow-900/20 border-b border-yellow-200 dark:border-yellow-800 px-6 py-3 flex items-center justify-between"
    >
      <div class="flex items-center gap-3">
        <span class="material-symbols-outlined text-yellow-600 dark:text-yellow-400">warning</span>
        <div>
          <p class="text-sm font-medium text-yellow-800 dark:text-yellow-200">Not logged in to Forge CLI</p>
          <p class="text-xs text-yellow-600 dark:text-yellow-400">
            Run <code class="bg-yellow-100 dark:bg-yellow-800 px-1.5 py-0.5 rounded font-mono">forge login</code> in your terminal to authenticate
          </p>
        </div>
      </div>
      <button
        @click="showLoginBanner = false"
        class="p-1 rounded hover:bg-yellow-100 dark:hover:bg-yellow-800 text-yellow-600 dark:text-yellow-400"
      >
        <span class="material-symbols-outlined text-[18px]">close</span>
      </button>
    </div>

    <!-- Error Banner -->
    <div
      v-if="store.error"
      class="bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800 px-6 py-3 flex items-center justify-between"
    >
      <div class="flex items-center gap-3">
        <span class="material-symbols-outlined text-red-600 dark:text-red-400">error</span>
        <p class="text-sm text-red-800 dark:text-red-200">{{ store.error }}</p>
      </div>
      <button
        @click="store.error = null"
        class="p-1 rounded hover:bg-red-100 dark:hover:bg-red-800 text-red-600 dark:text-red-400"
      >
        <span class="material-symbols-outlined text-[18px]">close</span>
      </button>
    </div>

    <!-- Main Content -->
    <div class="flex flex-1 overflow-hidden">
      <!-- Sidebar - Tabbed panels -->
      <aside class="w-80 shrink-0 flex flex-col border-r border-[#dbe0e6] dark:border-[#22303e] bg-white dark:bg-[#1a2632] overflow-hidden">
        <!-- Tab buttons -->
        <div class="flex shrink-0 border-b border-[#dbe0e6] dark:border-[#22303e]">
          <button
            @click="sidebarTab = 'envvars'"
            :class="[
              'flex-1 py-2.5 text-xs font-medium transition-colors',
              sidebarTab === 'envvars'
                ? 'text-primary border-b-2 border-primary bg-primary/5'
                : 'text-[#617589] hover:text-[#111418] dark:hover:text-white hover:bg-gray-50 dark:hover:bg-[#101922]'
            ]"
          >
            <span class="material-symbols-outlined text-[16px] align-middle mr-1">data_object</span>
            Env Vars
          </button>
          <button
            @click="sidebarTab = 'deployments'"
            :class="[
              'flex-1 py-2.5 text-xs font-medium transition-colors',
              sidebarTab === 'deployments'
                ? 'text-primary border-b-2 border-primary bg-primary/5'
                : 'text-[#617589] hover:text-[#111418] dark:hover:text-white hover:bg-gray-50 dark:hover:bg-[#101922]'
            ]"
          >
            <span class="material-symbols-outlined text-[16px] align-middle mr-1">rocket_launch</span>
            Deploys
          </button>
          <button
            @click="sidebarTab = 'installations'"
            :class="[
              'flex-1 py-2.5 text-xs font-medium transition-colors',
              sidebarTab === 'installations'
                ? 'text-primary border-b-2 border-primary bg-primary/5'
                : 'text-[#617589] hover:text-[#111418] dark:hover:text-white hover:bg-gray-50 dark:hover:bg-[#101922]'
            ]"
          >
            <span class="material-symbols-outlined text-[16px] align-middle mr-1">download</span>
            Installs
          </button>
        </div>

        <!-- Environment Variables Tab -->
        <div v-if="sidebarTab === 'envvars'" class="flex-1 flex flex-col overflow-hidden">
          <div class="p-3 border-b border-[#f0f2f4] dark:border-[#22303e] flex items-center justify-between shrink-0 bg-gray-50/50 dark:bg-[#1a2632]">
            <span class="text-xs text-[#617589]">Variables for {{ store.currentEnvironment }}</span>
            <div v-if="store.envVars" class="text-xs text-[#617589] font-medium">
              {{ Object.keys(store.envVars.variables).length }}
            </div>
          </div>

          <!-- Loading state -->
          <div v-if="store.loading.envVars" class="flex-1 flex items-center justify-center">
            <span class="material-symbols-outlined animate-spin text-[32px] text-gray-400">progress_activity</span>
          </div>

          <!-- Variables list -->
          <div v-else-if="store.envVars" class="flex-1 overflow-y-auto">
            <div
              v-for="(value, key) in store.envVars.variables"
              :key="key"
              class="flex flex-col px-4 py-3 border-b border-[#f0f2f4] dark:border-[#22303e] hover:bg-background-light dark:hover:bg-[#101922] group transition-colors"
            >
              <div class="flex justify-between items-center mb-0.5">
                <span class="text-xs font-semibold text-[#111418] dark:text-gray-200 font-mono">{{ key }}</span>
                <button
                  class="text-[#617589] hover:text-primary opacity-0 group-hover:opacity-100 transition-opacity"
                  @click="navigator.clipboard.writeText(String(value))"
                  title="Copy value"
                >
                  <span class="material-symbols-outlined text-[14px]">content_copy</span>
                </button>
              </div>
              <span class="text-xs font-mono text-[#617589] truncate" :title="String(value)">
                {{ value || '(empty)' }}
              </span>
            </div>
          </div>

          <!-- Empty state -->
          <div v-else class="flex-1 flex items-center justify-center text-gray-400 text-sm">
            <p>Select an app and environment</p>
          </div>
        </div>

        <!-- Deployments Tab -->
        <div v-else-if="sidebarTab === 'deployments'" class="flex-1 flex flex-col overflow-hidden">
          <div class="p-3 border-b border-[#f0f2f4] dark:border-[#22303e] flex items-center justify-between shrink-0 bg-gray-50/50 dark:bg-[#1a2632]">
            <div class="flex items-center gap-2">
              <span class="text-xs text-[#617589]">Deploys for {{ store.currentEnvironment || 'all' }}</span>
              <span v-if="filteredDeployments.length" class="text-[10px] text-gray-400 bg-gray-100 dark:bg-gray-700 rounded px-1.5 py-0.5">"{{ filteredDeployments.length }}"</span>
            </div>
            <span class="text-[10px] text-gray-400 px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded">Read-only</span>
          </div>

          <!-- Command display -->
          <div v-if="store.deployments?.command" class="px-3 py-2 border-b border-[#f0f2f4] dark:border-[#22303e] bg-gray-50 dark:bg-[#0d1620]">
            <div class="flex items-center justify-between mb-1">
              <span class="text-[10px] text-[#617589] uppercase tracking-wide">Command</span>
              <button
                @click="copyToClipboard(store.deployments.command)"
                class="text-[10px] text-primary hover:text-primary-dark flex items-center gap-1"
                title="Copy to clipboard"
              >
                <span class="material-symbols-outlined" style="font-size: 14px;">content_copy</span>
                Copy
              </button>
            </div>
            <code class="text-[10px] font-mono text-[#111418] dark:text-gray-300 break-all block bg-white dark:bg-[#1a2632] p-2 rounded border border-[#e0e4e8] dark:border-[#22303e]">
              {{ store.deployments.command }}
            </code>
          </div>

          <!-- Loading state -->
          <div v-if="store.loading.deployments" class="flex-1 flex items-center justify-center">
            <span class="material-symbols-outlined animate-spin text-[32px] text-gray-400">progress_activity</span>
          </div>

          <!-- Deployments list (filtered by current environment) -->
          <div v-else-if="filteredDeployments.length" class="flex-1 overflow-y-auto">
            <div
              v-for="(deployment, index) in filteredDeployments"
              :key="index"
              class="px-4 py-3 border-b border-[#f0f2f4] dark:border-[#22303e] hover:bg-background-light dark:hover:bg-[#101922] transition-colors"
            >
              <div class="flex items-center justify-between mb-1">
                <span class="text-xs font-semibold text-[#111418] dark:text-gray-200">{{ deployment.environment }}</span>
                <span class="text-[10px] font-mono text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                  v{{ deployment.version }}
                </span>
              </div>
              <div class="text-xs text-[#617589]">
                {{ formatDate(deployment.deployedAt) }}
              </div>
              <div v-if="deployment.deployedBy" class="text-xs text-[#9aaebf] mt-0.5">
                by {{ deployment.deployedBy }}
              </div>
            </div>
          </div>

          <!-- Empty state -->
          <div v-else class="flex-1 flex items-center justify-center text-gray-400 text-sm">
            <div class="text-center">
              <span class="material-symbols-outlined text-gray-300 dark:text-gray-600" style="font-size: 36px;">rocket_launch</span>
              <p class="mt-2">No deployments for {{ store.currentEnvironment || 'this app' }}</p>
            </div>
          </div>
        </div>

        <!-- Installations Tab -->
        <div v-else-if="sidebarTab === 'installations'" class="flex-1 flex flex-col overflow-hidden">
          <div class="p-3 border-b border-[#f0f2f4] dark:border-[#22303e] flex items-center justify-between shrink-0 bg-gray-50/50 dark:bg-[#1a2632]">
            <div class="flex items-center gap-2">
              <span class="text-xs text-[#617589]">Installs for {{ store.currentEnvironment || 'all' }}</span>
              <span v-if="filteredInstallations.length" class="text-[10px] text-gray-400 bg-gray-100 dark:bg-gray-700 rounded px-1.5 py-0.5">"{{ filteredInstallations.length }}"</span>
            </div>
            <span class="text-[10px] text-gray-400 px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded">Read-only</span>
          </div>

          <!-- Loading state -->
          <div v-if="store.loading.installations" class="flex-1 flex items-center justify-center">
            <span class="material-symbols-outlined animate-spin text-[32px] text-gray-400">progress_activity</span>
          </div>

          <!-- Installations list (filtered by current environment) -->
          <div v-else-if="filteredInstallations.length" class="flex-1 overflow-y-auto">
            <div
              v-for="(installation, index) in filteredInstallations"
              :key="index"
              class="px-4 py-3 border-b border-[#f0f2f4] dark:border-[#22303e] hover:bg-background-light dark:hover:bg-[#101922] transition-colors"
            >
              <div class="flex items-center gap-2 mb-1">
                <span class="material-symbols-outlined text-[14px] text-[#617589]">language</span>
                <span class="text-xs font-semibold text-[#111418] dark:text-gray-200 truncate" :title="installation.site">
                  {{ installation.site }}
                </span>
              </div>
              <div class="flex items-center gap-3 text-xs text-[#617589]">
                <span class="flex items-center gap-1">
                  <span class="material-symbols-outlined text-[12px]">inventory_2</span>
                  {{ installation.product }}
                </span>
                <span class="flex items-center gap-1">
                  <span class="material-symbols-outlined text-[12px]">dns</span>
                  {{ installation.environment }}
                </span>
              </div>
            </div>
          </div>

          <!-- Empty state -->
          <div v-else class="flex-1 flex items-center justify-center text-gray-400 text-sm">
            <div class="text-center">
              <span class="material-symbols-outlined text-gray-300 dark:text-gray-600" style="font-size: 36px;">download</span>
              <p class="mt-2">No installations for {{ store.currentEnvironment || 'this app' }}</p>
            </div>
          </div>
        </div>
      </aside>

      <!-- Main Panel - Logs -->
      <main class="flex-1 flex flex-col bg-white dark:bg-[#101922] overflow-hidden">
        <!-- Log toolbar -->
        <div class="flex items-center gap-3 px-4 py-2 border-b border-[#dbe0e6] dark:border-[#22303e] bg-gray-50/50 dark:bg-[#1a2632] shrink-0">
          <div class="flex items-center gap-2">
            <span class="material-symbols-outlined text-[#617589] text-[18px]">article</span>
            <h2 class="text-xs font-bold text-[#111418] dark:text-white uppercase tracking-wider">Tunnel Logs</h2>
          </div>
          <div class="text-xs text-[#617589]">
            {{ store.tunnelLogs.length }} entries
          </div>
          <div class="flex-1"></div>
          <label class="flex items-center gap-2 text-xs text-[#617589] cursor-pointer">
            <input type="checkbox" v-model="autoScroll" class="rounded border-gray-300">
            Auto-scroll
          </label>
          <button
            @click="store.clearLogs"
            class="flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-200 dark:hover:bg-[#22303e] text-[#617589] text-xs transition-colors"
          >
            <span class="material-symbols-outlined text-[16px]">delete_sweep</span>
            Clear
          </button>
        </div>

        <!-- Logs container -->
        <div
          ref="logContainer"
          class="flex-1 overflow-y-auto p-4 font-mono text-sm leading-relaxed"
          @scroll="scrollToBottom"
        >
          <!-- Empty state -->
          <div v-if="store.tunnelLogs.length === 0" class="h-full flex items-center justify-center">
            <div class="text-center">
              <span class="material-symbols-outlined text-gray-300 dark:text-gray-600" style="font-size: 48px;">terminal</span>
              <p class="text-gray-400 mt-2">
                {{ store.isTunnelRunning ? 'Waiting for logs...' : 'Start a tunnel to see logs' }}
              </p>
            </div>
          </div>

          <!-- Log entries -->
          <div
            v-for="(log, index) in store.tunnelLogs"
            :key="index"
            class="flex gap-3 py-0.5 hover:bg-gray-50 dark:hover:bg-[#1a2632] px-2 -mx-2 rounded select-text"
            :class="{ 'bg-red-50/50 dark:bg-red-900/10 border-l-2 border-red-500': log.level === 'error' }"
          >
            <span class="text-[#9aaebf] shrink-0 w-20 select-none text-xs pt-0.5">
              [{{ formatTime(log.timestamp) }}]
            </span>
            <span :class="[getLogLevelClass(log.level), 'font-bold shrink-0 w-12 text-xs pt-0.5 uppercase']">
              {{ log.level }}
            </span>
            <span class="text-[#334155] dark:text-gray-300 break-all">
              {{ log.message }}
            </span>
          </div>
        </div>
      </main>
    </div>

    <!-- Footer -->
    <footer class="shrink-0 flex items-center justify-between border-t border-[#dbe0e6] dark:border-[#22303e] bg-white dark:bg-[#1a2632] px-6 py-2 text-xs z-30">
      <div class="flex items-center gap-4 text-[#617589]">
        <span>Forge Console <span class="font-mono text-[#111418] dark:text-white">v1.0.0</span></span>
        <span class="w-px h-3 bg-[#dbe0e6] dark:bg-[#344155]"></span>
        <span v-if="store.currentApp">
          <span class="font-mono text-[#111418] dark:text-white">{{ store.currentApp.name }}</span>
          <span class="text-gray-400"> / </span>
          <span class="font-mono text-[#111418] dark:text-white">{{ store.currentEnvironment }}</span>
        </span>
      </div>
      <div class="flex items-center gap-4">
        <!-- Keyboard shortcuts hint -->
        <div class="hidden md:flex items-center gap-2 text-[#9aaebf]">
          <kbd class="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-[10px] font-mono">Ctrl+S</kbd>
          <span>Start</span>
          <span class="mx-1">/</span>
          <kbd class="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-[10px] font-mono">Ctrl+Q</kbd>
          <span>Stop</span>
        </div>
        <span class="w-px h-3 bg-[#dbe0e6] dark:bg-[#344155] hidden md:block"></span>
        <div v-if="store.isTunnelRunning" class="flex items-center gap-1.5 text-green-600 dark:text-green-400">
          <span class="material-symbols-outlined text-[14px]">wifi</span>
          <span class="font-medium">Tunnel Active</span>
        </div>
        <div v-else class="flex items-center gap-1.5 text-[#617589]">
          <span class="material-symbols-outlined text-[14px]">wifi_off</span>
          <span>Tunnel Inactive</span>
        </div>
      </div>
    </footer>
  </div>
</template>
