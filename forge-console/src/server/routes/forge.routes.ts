import { FastifyInstance } from 'fastify'
import { whoami, getDeployments, getInstallations, installApp, uninstallApp } from '../services/forge-cli.js'
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
            deployments: result.deployments || [],
            command: result.command
          }
        }
      } else {
        reply.code(500)
        return { success: false, error: result.error, command: result.command }
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
            installations: result.installations || [],
            command: result.command
          }
        }
      } else {
        reply.code(500)
        return { success: false, error: result.error, command: result.command }
      }
    } catch (error) {
      reply.code(500)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  })

  // Install app to a site
  fastify.post<{ Params: { appId: string }; Body: { site: string; environment: string } }>(
    '/api/apps/:appId/install',
    async (request, reply) => {
      const { appId } = request.params
      const { site, environment } = request.body

      if (!site || !environment) {
        reply.code(400)
        return { success: false, error: 'Missing site or environment' }
      }

      try {
        const merged = getMergedEnvVars(appId, environment)
        const result = await installApp(merged.variables, site, environment)

        if (result.success) {
          return {
            success: true,
            data: {
              command: result.command,
              output: result.output
            }
          }
        } else {
          reply.code(500)
          return { success: false, error: result.error, command: result.command }
        }
      } catch (error) {
        reply.code(500)
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        }
      }
    }
  )

  // Uninstall app from a site
  fastify.post<{ Params: { appId: string }; Body: { site: string; environment: string } }>(
    '/api/apps/:appId/uninstall',
    async (request, reply) => {
      const { appId } = request.params
      const { site, environment } = request.body

      if (!site || !environment) {
        reply.code(400)
        return { success: false, error: 'Missing site or environment' }
      }

      try {
        const merged = getMergedEnvVars(appId, environment)
        const result = await uninstallApp(merged.variables, site, environment)

        if (result.success) {
          return {
            success: true,
            data: {
              command: result.command,
              output: result.output
            }
          }
        } else {
          reply.code(500)
          return { success: false, error: result.error, command: result.command }
        }
      } catch (error) {
        reply.code(500)
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        }
      }
    }
  )
}
