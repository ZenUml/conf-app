import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { localCrmExtensionsPlugin } from './server/extensionsPlugin'
import { localCrmSitesPlugin } from './server/sitesPlugin'
// Server-only CommonJS/ESM boundary; the plugin is loaded by Vite, never bundled for the client.
// @ts-expect-error lifecyclePlugin is plain Node ESM to keep node:sqlite outside the client graph.
import { localCrmLifecyclePlugin } from './server/lifecyclePlugin.mjs'
import { installLocalCrmCredentials } from './server/localCredentials'

export default defineConfig(({ command, mode, isPreview }) => {
  if (command === 'serve' && mode !== 'test' && !isPreview) {
    installLocalCrmCredentials({ repoRoot: resolve(__dirname, '..') })
  }

  return {
    plugins: [localCrmExtensionsPlugin(), localCrmSitesPlugin(), localCrmLifecyclePlugin(), react()],
    root: '.',
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src')
      }
    },
    server: {
      port: 7331,
      host: '127.0.0.1'
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true
    }
  }
})
