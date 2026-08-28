import path, { resolve, dirname } from 'path';
import { defineConfig } from 'vite';
import createVuePlugin from '@vitejs/plugin-vue';
import { execSync } from "child_process";
import fs from 'fs'
import copy from 'rollup-plugin-copy'
import { visualizer } from 'rollup-plugin-visualizer'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);


console.log(process.env.NODE_ENV)
process.env.VITE_APP_GIT_HASH = execSync('git rev-parse --short HEAD').toString().trim()
process.env.VITE_APP_GIT_BRANCH = execSync('git branch --show-current').toString().trim()
// Scope --match to the current variant so that a lite build gets v*-lite, not v*-full,
// even when all three variant tags point to the same commit.
const _productType = process.env.PRODUCT_TYPE || 'full'
// Variants whose bundle carries the AsyncAPI runtime (@asyncapi/react-component
// viewer + the Studio editor iframe assets): the asyncapi variant, and lite
// since ADR-0005 Option A shipped the AsyncAPI macro there. Gates every
// asyncapi-specific build treatment below (CJS interop, fs/stream stubs,
// node polyfills, Studio asset copy) — full/diagramly stay untouched.
const _hasAsyncApiRuntime = _productType === 'asyncapi' || _productType === 'lite'
// Fallback for local/staging builds. Production release builds pass VITE_APP_VERSION
// explicitly from github.event.release.tag_name because git describe --abbrev=0
// returns the nearest reachable matching tag, not necessarily the release event tag.
process.env.VITE_APP_GIT_TAG = execSync(`git describe --tags --always --abbrev=0 --match "v*-${_productType}"`).toString().trim()
const appVersion = process.env.VITE_APP_VERSION || process.env.VITE_APP_GIT_TAG || 'dev'
console.log(`Building ${appVersion} (${process.env.VITE_APP_GIT_HASH}) on ${process.env.VITE_APP_GIT_BRANCH}`)

// Mixpanel token: CI passes via process.env (set from `vars.VITE_MIXPANEL_TOKEN`
// in staging-deploy.yml / release.yml). Local dev builds don't have that env var
// set, which would leave `mixpanel.init("")` in the bundle and drop all events.
// Fall back to reading `Token=` from .env.mixpanel (gitignored, each dev has
// their own copy) so `pnpm build:lite` from a clean shell still produces a
// bundle that emits analytics.
const mixpanelToken = (() => {
  if (process.env.VITE_MIXPANEL_TOKEN) return process.env.VITE_MIXPANEL_TOKEN
  try {
    const m = fs.readFileSync(path.resolve(__dirname, '.env.mixpanel'), 'utf8').match(/^Token=(.+)$/m)
    if (m?.[1]) return m[1].trim()
  } catch {}
  return ''
})()
if (!mixpanelToken) {
  console.warn('[vite] VITE_MIXPANEL_TOKEN is empty — analytics events will be dropped. Set the env var or populate .env.mixpanel.')
}

// Dev-only HTML entries — driven by `src/{test-viewer,viewerPreview,sandbox}.ts`.
// Each ships a sandbox/preview UI (`localStorage.mock*` flags, sandbox-preset
// catalog, etc.) that has no place in a production bundle. Excluding them
// drops their independent module graphs from `pnpm build:*` and trims the
// dist file count.
const DEV_ONLY_HTML_ENTRIES = new Set([
  'test-viewer.html',
  'viewer-preview.html',
  'editor-preview.html',
  'sandbox.html',
]);

function getHtmlFiles(dir, { isBuild = false } = {}) {
  const htmlFiles = [];
  const files = fs.readdirSync(dir);

  for (let i = 0; i < files.length; i++) {
    // Filter by NAME before touching the filesystem. Vite writes a temp
    // `vite.config.mjs.timestamp-<ts>-<rand>.mjs` into this very directory while
    // it loads this config and deletes it immediately afterwards, so a readdir
    // that catches it reaches lstat after it is gone and takes the whole run
    // down with ENOENT — observed on CI 2026-08-15, where `pnpm test:unit` died
    // at config load with `lstat 'vite.config.mjs.timestamp-…mjs'` and no test
    // ever ran. Checking the extension first means that file, and anything else
    // transient that is not .html, is never stat'd at all.
    if (path.extname(files[i]) !== '.html') continue;
    if (isBuild && DEV_ONLY_HTML_ENTRIES.has(files[i])) continue;

    const filepath = path.join(dir, files[i]);
    let stat;
    try {
      stat = fs.lstatSync(filepath);
    } catch {
      // Vanished between readdir and stat. Anything that transient is not a
      // real entry point, and it must not be able to fail the build.
      continue;
    }
    if (stat.isFile()) htmlFiles.push(filepath);
  }
  return htmlFiles;
}

export default defineConfig(({ command }) => ({
  base: './',
  define: {
    'import.meta.env.PRODUCT_TYPE': JSON.stringify(process.env.PRODUCT_TYPE || 'full'),
    'import.meta.env.VITE_MIXPANEL_TOKEN': JSON.stringify(mixpanelToken),
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion),
    'import.meta.env.VITE_APP_COMMIT': JSON.stringify(process.env.VITE_APP_GIT_HASH || 'unknown'),
    // Onboarding funnel — "second diagram" viewer prompt (33.6% of tenants
    // create exactly one diagram and never a second). Build-time constant,
    // deliberately NOT a Forge feature flag: Lite is already at the
    // Developer Console's 10-flags-per-app cap, and adding one requires
    // deleting a live flag first — a product-owner decision, not this
    // task's. Defaults OFF; flip this literal to JSON.stringify(true) and
    // redeploy to enable. See src/components/Viewer/SecondDiagramPrompt.vue.
    'import.meta.env.VITE_SECOND_DIAGRAM_PROMPT_ENABLED': JSON.stringify(false),
  },
  // Pre-bundle the hot CJS / Vue / CodeMirror cluster on dev-server cold start.
  // Without this, Vite discovers each lazily on first request and rebuilds the
  // dep graph mid-session, which jitters HMR for the first ~30s after launch.
  optimizeDeps: {
    include: [
      'vue',
      '@codemirror/state',
      '@codemirror/view',
      '@codemirror/language',
      '@codemirror/autocomplete',
      '@codemirror/lint',
      'codemirror-lang-mermaid',
      '@zenuml/codemirror-extensions',
      '@zenuml/core',
      // AsyncAPI variant: @asyncapi/parser pulls in CJS-only modules
      // (readable-stream, qs, avsc, @openapi-contrib/openapi-schema-to-json-schema)
      // whose default exports must be unwrapped via Vite's CJS-interop
      // pre-bundling — otherwise `import { Readable } from 'readable-stream'`
      // resolves to undefined and `class FooStream extends Readable` throws
      // "Class extends value undefined". Mirrors AsyncAPI-Conf-V2's vite config.
      ...(_hasAsyncApiRuntime
        ? [
            'readable-stream',
            'qs',
            'avsc',
            '@openapi-contrib/openapi-schema-to-json-schema',
          ]
        : []),
    ],
    ...(_hasAsyncApiRuntime
      ? {
          needsInterop: [
            'readable-stream',
            'qs',
            'avsc',
            '@openapi-contrib/openapi-schema-to-json-schema',
          ],
          exclude: ['stream-browserify', 'node-stdlib-browser'],
        }
      : {}),
  },
  build: {
    rollupOptions: {
      input: getHtmlFiles('./', { isBuild: command === 'build' })
    },

    // @asyncapi/parser's transitive deps (qs, avsc, readable-stream, …)
    // ship as mixed CJS/ESM. Enable transformMixedEsModules so Rollup
    // can handle the named-imports-from-CJS the parser depends on.
    commonjsOptions: _hasAsyncApiRuntime
      ? { transformMixedEsModules: true }
      : undefined,

    emptyOutDir: true,
    sourcemap: false,
    reportCompressedSize: false,
    minify: 'esbuild',
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      // Standalone dev-server only (command === 'serve', e.g. `pnpm start:local`):
      // @forge/bridge's own module-evaluation code (bridge.js's
      // getCallBridge()) throws synchronously outside a real Forge iframe —
      // not just when a bridge call is made, but the instant ANY static
      // `import {...} from '@forge/bridge'` is evaluated (aiTitleFeatureFlag.ts,
      // draftStore.ts, closeGuard.ts, CsatBanner.vue, CreateDemoPage.vue all
      // have one). That crashes the whole standalone/local-dev harness
      // (test-viewer.html, sandbox.html) before forgeGlobal's own try/catch
      // ever gets a chance to run. Storybook hit the identical problem and
      // fixed it with this exact alias (see .storybook/main.ts) — reuse it
      // here. A Forge tunnel still proxies Custom UI assets through a Vite dev
      // server, so joint-debug starts that server with FORGE_TUNNEL=1 to retain
      // the real bridge. `vite build` (command === 'build', every
      // `pnpm build:*` / production bundle) is untouched.
      ...(command === 'serve' && process.env.FORGE_TUNNEL !== '1'
        ? { '@forge/bridge': resolve(__dirname, './src/stubs/forge-bridge.ts') }
        : {}),
      // AsyncAPI variant: @asyncapi/parser pulls in Node's `fs` for its
      // fromURL/fromFile helpers (which we never call — we always pass a
      // pre-parsed schema). Earlier attempts aliased fs -> memfs but
      // memfs@4's internal class hierarchies blow up at module-eval time
      // ("class FileHandle extends <undefined>") under Rollup's CJS interop.
      // Use a hand-written stub instead: exports the names Rollup needs to
      // satisfy strict named-import resolution; bodies throw at call time,
      // which never happens because we don't invoke fromURL/fromFile.
      ...(_hasAsyncApiRuntime
        ? {
            'fs': resolve(__dirname, './src/stubs/empty-fs.ts'),
            'fs/promises': resolve(__dirname, './src/stubs/empty-fs.ts'),
            'stream': 'stream-browserify',
          }
        : {}),
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
        // @vue/compat removed. Pin whitespace to the pre-removal default
        // ('preserve') so rendered template whitespace stays byte-identical.
        // Vue 3's native default is 'condense'; adopting it is a separate change.
        whitespace: 'preserve',
      },
    },
  }),
  // Polyfill Node built-ins that leak through @asyncapi/parser (transitive
  // dep of @asyncapi/react-component used by forge-asyncapi-viewer). Mirror
  // the working config from AsyncAPI-Conf-V2: include buffer/process/util/
  // path/url/crypto/stream; exclude fs/os because they're aliased to memfs
  // / left unresolved below. Only variants that bundle the AsyncAPI viewer
  // (asyncapi, lite per ADR-0005) get this runtime — full/diagramly don't
  // import it.
  ...(_hasAsyncApiRuntime
    ? [nodePolyfills({
        protocolImports: true,
        globals: { Buffer: true, global: true, process: true },
        include: ['buffer', 'process', 'util', 'path', 'url', 'crypto', 'stream'],
        exclude: ['fs', 'os'],
      })]
    : []),
  // Dev-only: serve sandbox.html at "/" so engineers landing on
  // http://127.0.0.1:8080/ get the test-case index instead of the Forge
  // app entry (which only renders meaningfully inside a Confluence iframe).
  // index.html itself is unchanged — production build still uses it.
  {
    name: 'dev-root-to-sandbox',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        // Show sandbox cards at the root and at the bare /index.html.
        // Sandbox cards link to ./index.html?sandbox=<id>... — those (with a
        // query string) pass through unchanged so the actual Forge app mounts.
        if (req.url === '/' || req.url === '/index.html') {
          req.url = '/sandbox.html';
        }
        next();
      });
    },
  },
  copy({
    targets: [
      { src: 'node_modules/@zenuml/core/dist/fonts', dest: 'dist' },
      // Mermaid is loaded at runtime from /vendor/mermaid/ via dynamic URL
      // import (see src/utils/mermaid/loadMermaid.ts) so it's excluded from
      // the Rollup module graph. Copy the entire dist/ tree (entry +
      // chunks/) so the relative imports inside the entry resolve.
      { src: 'node_modules/mermaid/dist/*', dest: 'dist/vendor/mermaid' },
      // AsyncAPI Studio assets ship with the variants that carry the AsyncAPI
      // macro (asyncapi, lite per ADR-0005). Studio is loaded as a nested
      // iframe from the AsyncAPI editor and uses localStorage to sync the
      // document with the host; that requires same-origin, so Studio must
      // live under the same Forge resource as index.html
      // (`*.cdn.prod.atlassian-dev.net/<app-id>/asyncapi-studio/`).
      ...(_hasAsyncApiRuntime
        ? [{ src: 'static/asyncapi-studio', dest: 'dist' }]
        : []),
    ],
    hook: process.env.NODE_ENV === 'development' ? 'buildStart' : 'writeBundle'
  }), ...(process.env.ANALYZE === '1' ? [visualizer({
    filename: 'dist/stats.html',
    open: false,
    gzipSize: true,
    brotliSize: true,
  })] : []),
  // Build-only: emit dist/prefetch-manifest.json mapping renderer family →
  // hashed chunk paths (entry chunk + static import closure + CSS), consumed
  // by the idle renderer prefetch (src/utils/prefetch/prefetchAssets.ts).
  // Hashed names are unknowable at runtime (no build.manifest); this is the
  // only bridge. DrawIO/Mermaid use stable URLs and don't need the manifest.
  // If a refactor renames these entry chunks the family silently drops out of
  // the manifest — the renderer-prefetch unit test on family presence guards
  // a built dist (see docs/features/renderer-prefetch.md).
  {
    name: 'prefetch-manifest',
    apply: 'build',
    generateBundle(_options, bundle) {
      const FAMILIES = {
        sequence: [/^assets\/zenuml\.esm-/],
        openapi: [/^assets\/forge-swagger-ui-/, /^assets\/OpenApiViewer-.*\.js$/],
      };
      const renderers = {};
      for (const [family, patterns] of Object.entries(FAMILIES)) {
        const out = new Set();
        const addWithDeps = (fileName) => {
          if (out.has(fileName)) return;
          const chunk = bundle[fileName];
          if (!chunk) return;
          out.add(fileName);
          for (const dep of chunk.imports || []) addWithDeps(dep);
          for (const css of chunk.viteMetadata?.importedCss || []) out.add(css);
        };
        Object.keys(bundle)
          .filter((f) => patterns.some((re) => re.test(f)))
          .forEach(addWithDeps);
        if (out.size > 0) renderers[family] = [...out].sort();
      }
      this.emitFile({
        type: 'asset',
        fileName: 'prefetch-manifest.json',
        source: JSON.stringify({ version: 1, renderers }, null, 1),
      });
    },
  },
  // Dev-only plugin: serve /vendor/mermaid/* from node_modules/mermaid/dist/*.
  // The runtime loads mermaid via a dynamic URL import (src/utils/mermaid/loadMermaid.ts)
  // resolved against document.baseURI. rollup-plugin-copy puts the assets in dist/
  // for production, but Vite's dev server doesn't serve from dist/, so without
  // this middleware /vendor/mermaid/mermaid.esm.min.mjs hits the SPA fallback
  // (200 text/html) and the import fails.
  {
    name: 'vendor-mermaid-dev',
    apply: 'serve',
    configureServer(server) {
      const VENDOR_PREFIX = '/vendor/mermaid/';
      const SOURCE_DIR = path.join(__dirname, 'node_modules', 'mermaid', 'dist');
      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.startsWith(VENDOR_PREFIX)) return next();
        const relPath = req.url.slice(VENDOR_PREFIX.length).split('?')[0].split('#')[0];
        const abs = path.join(SOURCE_DIR, relPath);
        // Prevent path traversal outside SOURCE_DIR.
        if (!abs.startsWith(SOURCE_DIR + path.sep)) return next();
        if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return next();
        const ext = path.extname(abs);
        const contentType = ext === '.mjs' || ext === '.js' ? 'application/javascript'
          : ext === '.json' ? 'application/json'
          : ext === '.css' ? 'text/css'
          : 'application/octet-stream';
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'no-cache');
        fs.createReadStream(abs).pipe(res);
      });
    },
  },
  // Dev-only plugin: persist rerun test data to docs/fullscreen-test-rerun-data.json
  // so it survives across sessions without relying on localStorage.
  {
    name: 'rerun-data-api',
    configureServer(server) {
      const DATA_FILE = path.join(__dirname, 'docs', 'fullscreen-test-rerun-data.json');
      server.middlewares.use('/api/rerun-data', (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        if (req.method === 'GET') {
          try {
            res.end(fs.existsSync(DATA_FILE) ? fs.readFileSync(DATA_FILE, 'utf8') : '{}');
          } catch (e) {
            res.statusCode = 500; res.end(JSON.stringify({ error: e.message }));
          }
        } else if (req.method === 'POST') {
          let body = '';
          req.on('data', chunk => { body += chunk; });
          req.on('end', () => {
            try {
              JSON.parse(body); // validate
              fs.writeFileSync(DATA_FILE, body, 'utf8');
              res.end('{}');
            } catch (e) {
              res.statusCode = 400; res.end(JSON.stringify({ error: e.message }));
            }
          });
        } else {
          res.statusCode = 405; res.end();
        }
      });
    },
  },
  ],
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
      '**/.claude/worktrees/**',
      '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*',
      '**/tests/e2e-tests/**',
      '**/tests/export-modal/**',
      '**/packages/**',
      // Scratch dir — sessions park ad-hoc Playwright specs here; a stray
      // *.spec.ts under tmp/ otherwise fails the whole run at collection.
      '**/tmp/**',
      // Private customer-investigation contains ephemeral Playwright spot
      // checks. They are run with tests/e2e-tests' Playwright config, never
      // as root Vitest unit suites.
      '**/private/customer-investigation/**/*.spec.ts',
      // Skip the asyncapi-studio submodule's own tests — they import
      // upstream `@/*` aliases that aren't resolvable in our root tsconfig
      // and aren't relevant to this repo's test suite.
      '**/vendor/asyncapi-studio/**',
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
    allowedHosts: ['yanhui8080.zenuml.com', '8080.diagramly.net', 'precise-oriented-mink.ngrok-free.app', 'special-lemming-radically.ngrok-free.app', 'poc-fullscreen-app.zenuml.com'],
  }
}));
