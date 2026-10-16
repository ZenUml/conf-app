// The MCP Apps view (mcp-app/view.html), built on its own.
//
// WHY A SEPARATE BUILD. manifest.yml uploads dist/ as one Forge resource,
// capped at 5000 files, and a root HTML entry in vite.config.mjs makes Rollup
// re-split the whole Confluence app: the first attempt broke `Deploy: Lite`
// with "Each resource can only have up to 5000 files", mostly from the app's
// own chunks re-hashed. Built here, the view adds seven files under
// dist/mcp-app/ and leaves the app's chunks exactly as they were.
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
  // Absolute, so the bundle resolves against our origin once mcpApps.ts puts
  // <base href="<origin>/"> in front of it inside the host's frame.
  base: '/mcp-app/',
  // The app's public/ (drawio, studio, _routes.json) belongs to the main build.
  publicDir: false,
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
        // plus one for what both pull in. Left to itself Rollup splits mermaid
        // into dozens of files, which is the file count this build exists to
        // avoid; lumping everything into one renderer chunk instead made a
        // sequence diagram download mermaid too.
        manualChunks(id, { getModuleInfo }) {
          // Rollup/Vite helpers (preload, commonjs interop). Left unassigned
          // they are hoisted into whichever renderer chunk uses them first,
          // and the entry then imports that whole renderer up front.
          if (id === '\0vite/preload-helper.js' || id === '\0commonjsHelpers.js') return 'runtime';
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('/@zenuml/')) return 'zenuml';
          const zen = reachedFrom(id, '/@zenuml/', getModuleInfo);
          const mer = reachedFrom(id, '/mermaid/', getModuleInfo);
          if (zen && mer) return 'shared';
          if (zen) return 'zenuml';
          if (mer) return 'mermaid';
          return undefined; // the view's own small deps (pako) stay in its entry
        },
      },
    },
  },
});
