// Shared types between server and client

export interface AppConfig {
  name: string
  appId: string
  variables: Record<string, string>
  environments: Record<string, Record<string, string>>
}

export interface Config {
  version: string
  defaultApp: string
  apps: Record<string, AppConfig>
}

export interface AppInfo {
  id: string
  name: string
  appId: string
  environments: string[]
}

export interface MergedEnvVars {
  appId: string
  appName: string
  environment: string
  variables: Record<string, string>
}

export interface WhoAmIResponse {
  loggedIn: boolean
  email?: string
  error?: string
}

export interface TunnelStatus {
  status: 'stopped' | 'starting' | 'running' | 'error'
  app?: string
  environment?: string
  activeEnvVars?: Record<string, string>
  startedAt?: string
  error?: string
}

export type ForgeEnvironmentType = 'development' | 'staging' | 'production' | 'custom'

export interface ForgeEnvironment {
  name: string
  type: ForgeEnvironmentType
  canTunnel: boolean
}

// Standard Forge environments
export const FORGE_ENVIRONMENTS: ForgeEnvironment[] = [
  { name: 'development', type: 'development', canTunnel: true },
  { name: 'staging', type: 'staging', canTunnel: false },
  { name: 'production', type: 'production', canTunnel: false }
]

// Custom environments that support tunnel
export const CUSTOM_TUNNEL_ENVIRONMENTS = ['yanhui', 'peng-dev']

// Deployment types
export interface Deployment {
  environment: string
  version: string
  deployedAt: string
  deployedBy?: string
}

export interface DeploymentListResponse {
  appId: string
  deployments: Deployment[]
}

// Installation types
export interface Installation {
  site: string
  product: string
  environment: string
  installedAt?: string
}

export interface InstallationListResponse {
  appId: string
  installations: Installation[]
}
