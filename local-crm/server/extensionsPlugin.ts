import type { Plugin } from 'vite'
import { loadExtensionsResponse } from './extensionsLive'
import {
  EXTENSIONS_CONTRACT_VERSION,
  type ExtensionDetailResponse
} from '../src/data/extensionsContract'

function sendJson(
  response: import('node:http').ServerResponse,
  status: number,
  body: unknown
): void {
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.end(JSON.stringify(body))
}
export function localCrmExtensionsPlugin(): Plugin {
  return {
    name: 'local-crm-extensions-api',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1')
        const base = '/api/local-crm/extensions'
        if (url.pathname !== base && !url.pathname.startsWith(`${base}/`)) {
          next()
          return
        }
        if (request.method !== 'GET') {
          sendJson(response, 405, { error: 'method_not_allowed' })
          return
        }
        try {
          const data = await loadExtensionsResponse({ fresh: url.searchParams.get('fresh') === '1' })
          if (url.pathname === base) {
            sendJson(response, 200, data)
            return
          }
          const id = decodeURIComponent(url.pathname.slice(base.length + 1))
          const grant = data.grants.find(row => row.id === id)
          if (!grant) {
            sendJson(response, 404, { error: 'extension_not_found' })
            return
          }
          const detail: ExtensionDetailResponse = {
            contractVersion: EXTENSIONS_CONTRACT_VERSION,
            generatedAt: data.generatedAt,
            grant
          }
          sendJson(response, 200, detail)
        } catch (error) {
          sendJson(response, 503, {
            error: 'extensions_source_unavailable',
            detail: error instanceof Error ? error.message : String(error)
          })
        }
      })
    }
  }
}
