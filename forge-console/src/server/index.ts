import Fastify from 'fastify'
import cors from '@fastify/cors'
import { configRoutes } from './routes/config.routes.js'
import { forgeRoutes } from './routes/forge.routes.js'
import { tunnelRoutes } from './routes/tunnel.routes.js'

const fastify = Fastify({
  logger: true
})

// Enable CORS for development
await fastify.register(cors, {
  origin: ['http://localhost:3457', 'http://127.0.0.1:3457']
})

// Register routes
await fastify.register(configRoutes)
await fastify.register(forgeRoutes)
await fastify.register(tunnelRoutes)

// Health check
fastify.get('/api/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() }
})

// Start server
const start = async () => {
  try {
    await fastify.listen({ port: 3456, host: '0.0.0.0' })
    console.log('\n')
    console.log('='.repeat(50))
    console.log('  Forge Console Server')
    console.log('='.repeat(50))
    console.log(`  API:      http://localhost:3456`)
    console.log(`  Frontend: http://localhost:3457`)
    console.log('='.repeat(50))
    console.log('\n')
    console.log('Available endpoints:')
    console.log('  GET  /api/health')
    console.log('  GET  /api/whoami')
    console.log('  GET  /api/config')
    console.log('  GET  /api/apps')
    console.log('  GET  /api/apps/:appId')
    console.log('  GET  /api/apps/:appId/environments')
    console.log('  GET  /api/apps/:appId/envvars/:env')
    console.log('  GET  /api/apps/:appId/deployments')
    console.log('  GET  /api/apps/:appId/installations')
    console.log('  GET  /api/tunnel/status')
    console.log('  GET  /api/tunnel/logs')
    console.log('  GET  /api/tunnel/logs/stream  (SSE)')
    console.log('  POST /api/tunnel/start')
    console.log('  POST /api/tunnel/stop')
    console.log('\n')
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

start()
