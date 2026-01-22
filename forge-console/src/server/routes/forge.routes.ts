import { FastifyInstance } from 'fastify'
import { whoami, getDeployments, getInstallations } from '../services/forge-cli.js'
import { getMergedEnvVars } from '../services/env-vars.js'

export async function forgeRoutes(fastify: FastifyInstance) {
  // Check Forge login status
  fastify.get('/api/whoami', async () => {
    const result = await whoami()
    return result
  })

  // Get deployments for an app
  fastify.get<{ Params: { appId: string } }>('/api/apps/:appId/deployments', async (request, reply) => {
    const { appId } = request.params

    try {
      // Get env vars for the app (use development environment for the command)
      const merged = getMergedEnvVars(appId, 'development')
      const result = await getDeployments(merged.variables)

      if (result.success) {
        return {
          success: true,
          data: {
            appId,
            deployments: result.deployments || []
          }
        }
      } else {
        reply.code(500)
        return { success: false, error: result.error }
      }
    } catch (error) {
      reply.code(500)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  })

  // Get installations for an app
  fastify.get<{ Params: { appId: string } }>('/api/apps/:appId/installations', async (request, reply) => {
    const { appId } = request.params

    try {
      // Get env vars for the app (use development environment for the command)
      const merged = getMergedEnvVars(appId, 'development')
      const result = await getInstallations(merged.variables)

      if (result.success) {
        return {
          success: true,
          data: {
            appId,
            installations: result.installations || []
          }
        }
      } else {
        reply.code(500)
        return { success: false, error: result.error }
      }
    } catch (error) {
      reply.code(500)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  })
}
