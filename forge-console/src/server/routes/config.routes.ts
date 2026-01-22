import { FastifyInstance } from 'fastify'
import { loadConfig, getApps, getApp, getDefaultApp, getConfigPath } from '../services/config.js'
import { getMergedEnvVars, getAppEnvironments, canTunnel, getTunnelableEnvironments } from '../services/env-vars.js'

export async function configRoutes(fastify: FastifyInstance) {
  // Get full config
  fastify.get('/api/config', async () => {
    try {
      const config = loadConfig()
      return {
        success: true,
        data: config,
        configPath: getConfigPath()
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  })

  // List all apps
  fastify.get('/api/apps', async () => {
    try {
      const apps = getApps()
      const defaultApp = getDefaultApp()
      return {
        success: true,
        data: {
          apps,
          defaultApp
        }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  })

  // Get specific app
  fastify.get<{ Params: { appId: string } }>('/api/apps/:appId', async (request, reply) => {
    const { appId } = request.params

    try {
      const app = getApp(appId)
      if (!app) {
        reply.code(404)
        return { success: false, error: `App not found: ${appId}` }
      }

      return {
        success: true,
        data: app
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  })

  // Get environments for an app
  fastify.get<{ Params: { appId: string } }>('/api/apps/:appId/environments', async (request, reply) => {
    const { appId } = request.params

    try {
      const environments = getAppEnvironments(appId)
      const tunnelable = getTunnelableEnvironments(appId)

      return {
        success: true,
        data: {
          environments: environments.map(env => ({
            name: env,
            canTunnel: canTunnel(env)
          })),
          tunnelable
        }
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        reply.code(404)
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  })

  // Get merged env vars for app + environment
  fastify.get<{ Params: { appId: string; env: string } }>(
    '/api/apps/:appId/envvars/:env',
    async (request, reply) => {
      const { appId, env } = request.params

      try {
        const merged = getMergedEnvVars(appId, env)
        return {
          success: true,
          data: merged
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes('not found')) {
          reply.code(404)
        }
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        }
      }
    }
  )
}
