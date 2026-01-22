import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { tunnelManager } from '../services/tunnel.js'
import { getMergedEnvVars, canTunnel } from '../services/env-vars.js'

interface StartTunnelBody {
  appId: string
  environment: string
}

export async function tunnelRoutes(fastify: FastifyInstance) {
  // Get tunnel status
  fastify.get('/api/tunnel/status', async () => {
    return {
      success: true,
      data: tunnelManager.getStatus()
    }
  })

  // Get tunnel logs
  fastify.get('/api/tunnel/logs', async () => {
    return {
      success: true,
      data: tunnelManager.getLogs()
    }
  })

  // Start tunnel
  fastify.post<{ Body: StartTunnelBody }>('/api/tunnel/start', async (request, reply) => {
    const { appId, environment } = request.body

    if (!appId || !environment) {
      reply.code(400)
      return {
        success: false,
        error: 'appId and environment are required'
      }
    }

    // Check if environment supports tunnel
    if (!canTunnel(environment)) {
      reply.code(400)
      return {
        success: false,
        error: `Environment "${environment}" does not support tunnel. Only development and custom environments support tunnel.`
      }
    }

    try {
      // Get merged environment variables
      const merged = getMergedEnvVars(appId, environment)

      // Start the tunnel
      const result = await tunnelManager.start(appId, environment, merged.variables)

      if (result.success) {
        return {
          success: true,
          data: tunnelManager.getStatus()
        }
      } else {
        reply.code(500)
        return {
          success: false,
          error: result.error
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

  // Stop tunnel
  fastify.post('/api/tunnel/stop', async (request, reply) => {
    try {
      const result = await tunnelManager.stop()

      if (result.success) {
        return {
          success: true,
          data: tunnelManager.getStatus()
        }
      } else {
        reply.code(500)
        return {
          success: false,
          error: result.error
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

  // SSE endpoint for real-time logs
  fastify.get('/api/tunnel/logs/stream', async (request: FastifyRequest, reply: FastifyReply) => {
    // Set SSE headers
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    })

    // Send initial status
    const status = tunnelManager.getStatus()
    reply.raw.write(`event: status\ndata: ${JSON.stringify(status)}\n\n`)

    // Send existing logs
    const logs = tunnelManager.getLogs()
    for (const log of logs) {
      reply.raw.write(`event: log\ndata: ${JSON.stringify(log)}\n\n`)
    }

    // Subscribe to new logs
    const onLog = (log: unknown) => {
      reply.raw.write(`event: log\ndata: ${JSON.stringify(log)}\n\n`)
    }

    // Subscribe to status changes
    const onStatus = (newStatus: unknown) => {
      reply.raw.write(`event: status\ndata: ${JSON.stringify(newStatus)}\n\n`)
    }

    tunnelManager.on('log', onLog)
    tunnelManager.on('status', onStatus)

    // Send heartbeat every 30 seconds
    const heartbeat = setInterval(() => {
      reply.raw.write(`:heartbeat\n\n`)
    }, 30000)

    // Cleanup on close
    request.raw.on('close', () => {
      tunnelManager.off('log', onLog)
      tunnelManager.off('status', onStatus)
      clearInterval(heartbeat)
    })

    // Keep connection open
    await new Promise(() => {})
  })
}
