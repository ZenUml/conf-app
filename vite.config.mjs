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
// Scope --match to the current variant so that a lite build gets v*-lite, not v*-full,
// even when all three variant tags point to the same commit.
const _productType = process.env.PRODUCT_TYPE || 'full'
// Fallback for local/staging builds. Production release builds pass VITE_APP_VERSION
// explicitly from github.event.release.tag_name because git describe --abbrev=0
// returns the nearest reachable matching tag, not necessarily the release event tag.
process.env.VITE_APP_GIT_TAG = execSync(`git describe --tags --always --abbrev=0 --match "v*-${_productType}"`).toString().trim()
const appVersion = process.env.VITE_APP_VERSION || process.env.VITE_APP_GIT_TAG || 'dev'
console.log(`Building ${appVersion} (${process.env.VITE_APP_GIT_HASH}) on ${process.env.VITE_APP_GIT_BRANCH}`)

// Dev-only HTML entries — driven by `src/{test-viewer,viewerPreview,sandbox}.ts`.
// Each ships a sandbox/preview UI (`localStorage.mock*` flags, sandbox-preset
// catalog, etc.) that has no place in a production bundle. Excluding them
// drops their independent module graphs from `pnpm build:*` and trims the
// dist file count.
const DEV_ONLY_HTML_ENTRIES = new Set([
  'test-viewer.html',
  'viewer-preview.html',
  'sandbox.html',
]);

function getHtmlFiles(dir, { isBuild = false } = {}) {
  const htmlFiles = [];
  const files = fs.readdirSync(dir);

  for (let i = 0; i < files.length; i++) {
    const filepath = path.join(dir, files[i]);
    if (fs.lstatSync(filepath).isFile() && path.extname(filepath) === '.html') {
      if (isBuild && DEV_ONLY_HTML_ENTRIES.has(files[i])) continue;
      htmlFiles.push(filepath);
    }
  }
  return htmlFiles;
}

export default defineConfig(({ command }) => ({
  base: './',
  define: {
    'import.meta.env.PRODUCT_TYPE': JSON.stringify(process.env.PRODUCT_TYPE || 'full'),
    'import.meta.env.VITE_MIXPANEL_TOKEN': JSON.stringify(process.env.VITE_MIXPANEL_TOKEN || ''),
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion),
    'import.meta.env.VITE_APP_COMMIT': JSON.stringify(process.env.VITE_APP_GIT_HASH || 'unknown'),
  },
  // Pre-bundle the hot CJS / Vue / CodeMirror cluster on dev-server cold start.
  // Without this, Vite discovers each lazily on first request and rebuilds the
  // dep graph mid-session, which jitters HMR for the first ~30s after launch.
  optimizeDeps: {
    include: [
      'vue',
      '@vue/compat',
      '@codemirror/state',
      '@codemirror/view',
      '@codemirror/language',
      '@codemirror/autocomplete',
      '@codemirror/lint',
      'codemirror-lang-mermaid',
      '@zenuml/codemirror-extensions',
      '@zenuml/core',
    ],
  },
  build: {
    rollupOptions: {
      input: getHtmlFiles('./', { isBuild: command === 'build' })
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
      { src: 'node_modules/@zenuml/core/dist/fonts', dest: 'dist' },
      // Mermaid is loaded at runtime from /vendor/mermaid/ via dynamic URL
      // import (see src/utils/mermaid/loadMermaid.ts) so it's excluded from
      // the Rollup module graph. Copy the entire dist/ tree (entry +
      // chunks/) so the relative imports inside the entry resolve.
      { src: 'node_modules/mermaid/dist/*', dest: 'dist/vendor/mermaid' }
    ],
    hook: process.env.NODE_ENV === 'development' ? 'buildStart' : 'writeBundle'
  }), ...(process.env.ANALYZE === '1' ? [visualizer({
    filename: 'dist/stats.html',
    open: false,
    gzipSize: true,
    brotliSize: true,
  })] : [])],
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
      '**/.worktree/**',
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
      '/api/analytics': {
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
}));
