// The MCP Apps view (mcp-app/view.html), built on its own.
//
// WHY A SEPARATE BUILD. manifest.yml uploads dist/ as one Forge resource,
// capped at 5000 files, and a root HTML entry in vite.config.mjs makes Rollup
// re-split the whole Confluence app: the first attempt broke `Deploy: Lite`
// with "Each resource can only have up to 5000 files", mostly from the app's
// own chunks re-hashed. Built here, the view adds about 70 files under
// dist/mcp-app/ (most of them mermaid's per-diagram chunks) and leaves the
// app's chunks exactly as they were.
//
// It runs AFTER the main build (see the build:* scripts), because that build
// empties dist/. This one empties only its own outDir.
//
// Served from the Pages deploy at /mcp-app/view.html, which
// functions/agent-link/oauth/mcpApps.ts reads as the ui://zenuml/diagram body.
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** [chunk name, path fragment of the renderer package], one chunk per renderer. */
const RENDERERS = [
  ['zenuml', '/@zenuml/'],
  ['mermaid', '/mermaid/'],
  ['openapi', '/swagger-ui/'],
];

/**
 * Renderers whose code Rollup splits by itself rather than into one chunk.
 * Mermaid's diagram types sit behind its own import()s, so its natural split
 * is a small core plus a chunk per diagram family: about 60 more files under
 * dist/mcp-app/, which count toward Forge's 5000-file resource limit together
 * with the app's own dist/ (#1038 records the total).
 */
const LAZY_RENDERERS = new Set(['mermaid']);

/** Whether `id` is imported, directly or transitively, by a module whose path contains `pkg`. */
function reachedFrom(id, pkg, getModuleInfo, seen = new Set()) {
  if (seen.has(id)) return false;
  seen.add(id);
  for (const importer of [...(getModuleInfo(id)?.importers ?? []), ...(getModuleInfo(id)?.dynamicImporters ?? [])]) {
    if (importer.includes(pkg)) return true;
    if (importer.includes('node_modules') && reachedFrom(importer, pkg, getModuleInfo, seen)) return true;
  }
  return false;
}

export default defineConfig({
  root: resolve(__dirname, 'mcp-app'),
  // Relative, so the preload links Vite builds INSIDE the bundles resolve from
  // import.meta.url — the chunk's own absolute URL on our origin. A root base
  // ('/mcp-app/') made them root-relative, which inside the host's frame point
  // at the host's sandbox origin and 404. The entry html's own ./ references
  // are made absolute when served (mcpApps.ts withAbsoluteAssetUrls).
  base: './',
  // The app's public/ (drawio, studio, _routes.json) belongs to the main build.
  // This build's own public/ holds only assets/404.html, which makes Pages
  // answer a missing /mcp-app/assets/ file with a 404 rather than the SPA.
  publicDir: resolve(__dirname, 'mcp-app/public'),
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  build: {
    outDir: resolve(__dirname, 'dist/mcp-app'),
    emptyOutDir: true,
    sourcemap: false,
    reportCompressedSize: false,
    minify: 'esbuild',
    rollupOptions: {
      input: resolve(__dirname, 'mcp-app/view.html'),
      output: {
        // One chunk per renderer, loaded only when that diagram type arrives,
        // plus one for what both pull in, except mermaid (LAZY_RENDERERS),
        // which Rollup splits along mermaid's own per-diagram import()s.
        // Lumping everything into one renderer chunk made a sequence diagram
        // download mermaid too.
        manualChunks(id, { getModuleInfo }) {
          // Rollup/Vite helpers (preload, commonjs interop). Left unassigned
          // they are hoisted into whichever renderer chunk uses them first,
          // and the entry then imports that whole renderer up front.
          if (id === '\0vite/preload-helper.js' || id === '\0commonjsHelpers.js') return 'runtime';
          if (!id.includes('node_modules')) return undefined;
          const own = RENDERERS.find(([, pkg]) => id.includes(pkg));
          // Mermaid is left to Rollup (#1038): mermaid itself loads each diagram
          // type's code with import(), and forcing all of it into one chunk made
          // a flowchart download mindmap, treemap, cytoscape, elk and KaTeX too
          // (869 KB brotli; 204 KB split). See LAZY_RENDERERS for the file cost.
          if (own) return LAZY_RENDERERS.has(own[0]) ? undefined : own[0];
          // A dependency goes with the renderer that uses it; one used by
          // several goes in a chunk named for exactly those, so no renderer
          // downloads another's code (mermaid and swagger-ui share dompurify).
          const users = RENDERERS.filter(([, pkg]) => reachedFrom(id, pkg, getModuleInfo)).map(([name]) => name);
          if (users.length > 1) return `shared-${users.join('-')}`;
          if (users.length === 1) return LAZY_RENDERERS.has(users[0]) ? undefined : users[0];
          return undefined; // the view's own small deps (pako, lzutf8) stay in their own chunks
        },
      },
    },
  },
});
