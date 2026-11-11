import { loadLifecycleResponse } from './lifecycleLive.mjs'

function sendJson(response, status, body) {
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.end(JSON.stringify(body))
}

export function localCrmLifecyclePlugin() {
  return {
    name: 'local-crm-lifecycle-api',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1')
        if (url.pathname !== '/api/local-crm/lifecycle') return next()
        if (request.method !== 'GET') return sendJson(response, 405, { error: 'method_not_allowed' })
        try {
          sendJson(response, 200, await loadLifecycleResponse({ fresh: url.searchParams.get('fresh') === '1' }))
        } catch (error) {
          sendJson(response, 503, { error: 'lifecycle_source_unavailable', detail: error instanceof Error ? error.message : String(error) })
        }
      })
    }
  }
}
