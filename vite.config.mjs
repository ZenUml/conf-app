import path, { resolve, dirname } from 'path';
import { defineConfig } from 'vite';
import createVuePlugin from '@vitejs/plugin-vue';
import { execSync } from "child_process";
import fs from 'fs'
import copy from 'rollup-plugin-copy'
import { visualizer } from 'rollup-plugin-visualizer'
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);


console.log(process.env.NODE_ENV)
process.env.VITE_APP_GIT_HASH = execSync('git rev-parse --short HEAD').toString().trim()
process.env.VITE_APP_GIT_BRANCH = execSync('git branch --show-current').toString().trim()
// https://stackoverflow.com/a/45993185/529187
process.env.VITE_APP_GIT_TAG = execSync('git describe --tags --always --abbrev=0').toString().trim()
console.log(`Building ${process.env.VITE_APP_GIT_TAG} (${process.env.VITE_APP_GIT_HASH}) on ${process.env.VITE_APP_GIT_BRANCH}`)

function getHtmlFiles(dir) {
  const htmlFiles = [];
  const files = fs.readdirSync(dir);

  for (let i = 0; i < files.length; i++) {
    const filepath = path.join(dir, files[i]);
    if (fs.lstatSync(filepath).isFile()) {
      if (path.extname(filepath) === '.html') {
        htmlFiles.push(filepath);
      }
    }
  }
  return htmlFiles;
}

export default defineConfig({
  base: './',
  define: {
    'import.meta.env.PRODUCT_TYPE': JSON.stringify(process.env.PRODUCT_TYPE || 'full'),
  },
  build: {
    rollupOptions: {
      input: getHtmlFiles('./')
    },

    emptyOutDir: true,
    sourcemap: false,
    reportCompressedSize: false,
    minify: 'esbuild',
  },
  resolve: {
    alias: {
      'vue': '@vue/compat',
      '@': resolve(__dirname, './src')
    },
    dedupe: [
      '@codemirror/state',
      '@codemirror/view',
      '@codemirror/language',
      '@codemirror/autocomplete',
      '@lezer/lr',
      '@lezer/highlight',
    ]
  },
  plugins: [createVuePlugin({
    template: {
      compilerOptions: {
        compatConfig: {
          MODE: 2,
        },
      },
    },
  }), copy({
    targets: [
      { src: 'node_modules/@zenuml/core/dist/fonts', dest: 'dist' }
    ],
    hook: process.env.NODE_ENV === 'development' ? 'buildStart' : 'writeBundle'
  }), visualizer({
    filename: 'dist/stats.html',
    open: false,
    gzipSize: true,
    brotliSize: true,
  })],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/test-setup.ts'],
    coverage: {
      provider: 'v8',
    },
    server: {
      deps: {
        inline: ['@vue/test-utils'],
      },
    },
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.worktrees/**',
      '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*',
      '**/tests/e2e-tests/**',
      '**/tests/export-modal/**',
      '**/packages/**',
    ],
  },
  server: {
    host: '0.0.0.0',
    port: 8080,
    proxy: {
      '/authenticate': {
        target: 'http://127.0.0.1:8788/',
        changeOrigin: true
      },
      '/api/metrics/evaluation': {
        target: 'http://127.0.0.1:8788/',
        changeOrigin: true
      },
      '/api/features': {
        target: 'http://127.0.0.1:8788/',
        changeOrigin: true
      },
      '/attachment': {
        target: 'http://127.0.0.1:8788/',
        changeOrigin: true
      },
      '/track': {
        target: 'http://127.0.0.1:8788/',
        changeOrigin: true,
      },
      '/diagramly': {
        target: 'http://127.0.0.1:8788/',
        changeOrigin: true
      },
      '/diagram-likes': {
        target: 'http://127.0.0.1:8788/',
        changeOrigin: true
      },
      '/uninstalled': {
        target: 'http://127.0.0.1:8788/',
        changeOrigin: true
      }
    },
    allowedHosts: ['yanhui8080.zenuml.com', '8080.diagramly.net', 'precise-oriented-mink.ngrok-free.app', 'special-lemming-radically.ngrok-free.app'],
  }
});
