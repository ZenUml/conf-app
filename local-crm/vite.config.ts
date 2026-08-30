import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { localCrmExtensionsPlugin } from './server/extensionsPlugin'
import { localCrmSitesPlugin } from './server/sitesPlugin'
import { installLocalCrmCredentials } from './server/localCredentials'

export default defineConfig(({ command, mode, isPreview }) => {
  if (command === 'serve' && mode !== 'test' && !isPreview) {
    installLocalCrmCredentials({ repoRoot: resolve(__dirname, '..') })
  }

  return {
    plugins: [localCrmExtensionsPlugin(), localCrmSitesPlugin(), react()],
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
