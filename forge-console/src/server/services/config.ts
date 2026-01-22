import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import type { Config, AppInfo } from '../../shared/types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Default config path - relative to project root
const DEFAULT_CONFIG_PATH = resolve(__dirname, '../../../../.forge-console/config.json')

let cachedConfig: Config | null = null
let configPath = DEFAULT_CONFIG_PATH

export function setConfigPath(path: string): void {
  configPath = path
  cachedConfig = null
}

export function getConfigPath(): string {
  return configPath
}

export function loadConfig(forceReload = false): Config {
  if (cachedConfig && !forceReload) {
    return cachedConfig
  }

  if (!existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`)
  }

  try {
    const content = readFileSync(configPath, 'utf-8')
    cachedConfig = JSON.parse(content) as Config
    return cachedConfig
  } catch (error) {
    throw new Error(`Failed to parse config file: ${error}`)
  }
}

export function getApps(): AppInfo[] {
  const config = loadConfig()

  return Object.entries(config.apps).map(([id, app]) => ({
    id,
    name: app.name,
    appId: app.appId,
    environments: Object.keys(app.environments)
  }))
}

export function getApp(appId: string): AppInfo | null {
  const config = loadConfig()
  const app = config.apps[appId]

  if (!app) {
    return null
  }

  return {
    id: appId,
    name: app.name,
    appId: app.appId,
    environments: Object.keys(app.environments)
  }
}

export function getDefaultApp(): string {
  const config = loadConfig()
  return config.defaultApp
}
