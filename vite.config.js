import { sentryVitePlugin } from "@sentry/vite-plugin";
import path, {resolve} from 'path';
import {defineConfig, splitVendorChunkPlugin} from 'vite';
import createVuePlugin from '@vitejs/plugin-vue';
import {execSync} from "child_process";
import fs from 'fs'
import {createFilter} from '@rollup/pluginutils';
import copy from 'rollup-plugin-copy'


const filter = createFilter(['./drawio/**/*']);
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
  build: {
    rollupOptions: {
      input: getHtmlFiles('./').concat(getHtmlFiles('./drawio')),
      output: {
        // TODO: improve the strategy
        manualChunks(id) {
          if (!filter(id)) {
            return; // 跳过 ./drawio 下的文件
          }

          if ((id.includes('node_modules') && id.includes('swagger'))) {
            return 'swagger'
          }

          if (id.includes('mermaid')) {
            return 'mermaid'
          }

          if (id.includes('lodash')) {
            return 'lodash'
          }

          if (id.includes('mixpanel')) {
            return 'mixpanel'
          }

          if (id.includes('codemirror')) {
            return 'codemirror'
          }

          if (id.includes('@zenuml/core')) {
            return '@zenuml/core'
          }
        }
      }
    },

    emptyOutDir: true,
    sourcemap: true
  },
  resolve: {
    alias: {
      'vue': '@vue/compat',
      '@': resolve(__dirname, './src')
    },
  },
  plugins: [splitVendorChunkPlugin(), createVuePlugin({
    template: {
      compilerOptions: {
        compatConfig: {
          MODE: 2,
        },
      },
    },
  }), copy({
    targets: [
      {src: 'node_modules/@zenuml/core/dist/fonts', dest: 'dist'}
    ],
    hook: process.env.NODE_ENV === 'development' ? 'buildStart' : 'writeBundle'
  }), sentryVitePlugin({
    org: "zenuml",
    project: "nodejs"
  })],
  test: {
    environment: 'jsdom',
    globals: true,
    coverage: {
      provider: 'v8',
    },
    deps: {
      inline: ['@vue/test-utils'],
    },
  },
  server: {
    host: '0.0.0.0',
    port: 8080,
    proxy: {
      '/authenticate': {
        target: 'http://127.0.0.1:8788/',
        changeOrigin: true
      },
      '/attachment': {
        target: 'http://127.0.0.1:8788/',
        changeOrigin: true
      },
      '/atlassian-connect-lite.json': {
        target: 'http://127.0.0.1:8788/',
        changeOrigin: true
      },
      '/descriptor': {
        target: 'http://127.0.0.1:8788/',
        changeOrigin: false,
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
      '/installed': {
        target: 'http://127.0.0.1:8788/',
        changeOrigin: true
      },
      '/uninstalled': {
        target: 'http://127.0.0.1:8788/',
        changeOrigin: true
      }
    },
    allowedHosts: ['yanhui8080.zenuml.com', 'peng-new-8080.diagramly.ai', 'precise-oriented-mink.ngrok-free.app', 'special-lemming-radically.ngrok-free.app'],
  }
});