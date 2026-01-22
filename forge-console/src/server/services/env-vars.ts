import { loadConfig } from './config.js'
import type { MergedEnvVars } from '../../shared/types.js'

/**
 * Merge common variables with environment-specific variables
 * Environment-specific variables override common variables
 */
export function getMergedEnvVars(appId: string, environment: string): MergedEnvVars {
  const config = loadConfig()
  const app = config.apps[appId]

  if (!app) {
    throw new Error(`App not found: ${appId}`)
  }

  const envConfig = app.environments[environment]
  if (!envConfig) {
    throw new Error(`Environment not found: ${environment} for app ${appId}`)
  }

  // Start with APP_ID (always needed for forge commands)
  const variables: Record<string, string> = {
    APP_ID: app.appId
  }

  // Merge common variables
  Object.assign(variables, app.variables)

  // Merge environment-specific variables (override common)
  Object.assign(variables, envConfig)

  return {
    appId,
    appName: app.name,
    environment,
    variables
  }
}

/**
 * Get all available environments for an app
 */
export function getAppEnvironments(appId: string): string[] {
  const config = loadConfig()
  const app = config.apps[appId]

  if (!app) {
    throw new Error(`App not found: ${appId}`)
  }

  return Object.keys(app.environments)
}

/**
 * Check if an environment supports tunnel
 * Only development and custom environments support tunnel
 */
export function canTunnel(environment: string): boolean {
  // staging and production don't support tunnel
  if (environment === 'staging' || environment === 'production') {
    return false
  }
  // All other environments (development, custom) support tunnel
  return true
}

/**
 * Get tunnelable environments for an app
 */
export function getTunnelableEnvironments(appId: string): string[] {
  const environments = getAppEnvironments(appId)
  return environments.filter(canTunnel)
}
