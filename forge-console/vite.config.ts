import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  root: '.',
  publicDir: 'public',
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  },
  server: {
    port: 3457,
    proxy: {
      '/api': {
        target: 'http://localhost:3456',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'dist/client',
    emptyOutDir: true
  }
})
