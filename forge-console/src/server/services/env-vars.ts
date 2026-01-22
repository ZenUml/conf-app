import { loadConfig } from './config.js'
import type { MergedEnvVars } from '../../shared/types.js'

/**
 * Merge common variables with environment-specific variables
 * Environment-specific variables override common variables
 *
 * For environments that exist in Forge but not in config,
 * we use only the common app variables (no env-specific overrides)
 */
export function getMergedEnvVars(appId: string, environment: string): MergedEnvVars {
  const config = loadConfig()
  const app = config.apps[appId]

  if (!app) {
    throw new Error(`App not found: ${appId}`)
  }

  // Environment config may not exist for custom Forge environments
  const envConfig = app.environments[environment] || {}

  // Start with APP_ID (always needed for forge commands)
  const variables: Record<string, string> = {
    APP_ID: app.appId
  }

  // Merge common variables
  Object.assign(variables, app.variables)

  // Merge environment-specific variables (override common) if they exist
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
