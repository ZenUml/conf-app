import { FastifyInstance } from 'fastify'
import { loadConfig, getApps, getApp, getDefaultApp, getConfigPath } from '../services/config.js'
import { getMergedEnvVars } from '../services/env-vars.js'
import { getForgeEnvironments } from '../services/forge-cli.js'

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

  // Get environments for an app (fetches from Forge CLI)
  fastify.get<{ Params: { appId: string } }>('/api/apps/:appId/environments', async (request, reply) => {
    const { appId } = request.params

    try {
      // Verify app exists
      const app = getApp(appId)
      if (!app) {
        reply.code(404)
        return { success: false, error: `App not found: ${appId}` }
      }

      // Get environments from Forge CLI
      const result = await getForgeEnvironments()

      if (!result.success) {
        reply.code(500)
        return { success: false, error: result.error }
      }

      const environments = result.environments || []
      const tunnelable = environments.filter(e => e.canTunnel).map(e => e.name)

      return {
        success: true,
        data: {
          environments: environments.map(env => ({
            name: env.name,
            type: env.type,
            canTunnel: env.canTunnel
          })),
          tunnelable
        }
      }
    } catch (error) {
      reply.code(500)
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
