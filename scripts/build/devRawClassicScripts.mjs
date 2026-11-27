// Dev-only: serve classic scripts exactly as they are on disk.
//
// The Mixpanel SDK starts session replay by adding a classic
// `<script src>` for `mixpanel-browser/dist/mixpanel-recorder.min.js`
// (src/utils/analytics/mixpanelClient.ts imports it with `?url`). Under
// `vite dev`, every JS request goes through the transform pipeline, and
// vite-plugin-node-polyfills' inject step prepends
// `import { default as Buffer } from "…"` and the same for `process` to any
// file that mentions those globals. The recorder does, so the browser parses
// an ES module as a classic script and throws
// "Cannot use import statement outside a module"; session replay never
// starts in dev and Forge tunnel sessions log the error to Clarity.
//
// Builds are not affected: the `?url` import emits the file as an asset copy.
//
// This middleware answers a plain request (no query string) for a listed
// file with the file's bytes, before Vite's transform middleware sees it.
// Requests with a query (`?url`, `?import`, `?v=`) still go to Vite.
import fs from 'fs';
import path from 'path';

// Package-relative paths of files that are only ever loaded as classic scripts.
export const RAW_CLASSIC_SCRIPTS = ['mixpanel-browser/dist/mixpanel-recorder.min.js'];

/**
 * Returns the absolute file to serve untransformed for a dev-server request
 * URL, or null when Vite should handle the request.
 */
export function rawClassicScriptFile(url, root, scripts = RAW_CLASSIC_SCRIPTS) {
  if (!url || url.includes('?')) return null;
  let pathname;
  try {
    pathname = decodeURIComponent(url);
  } catch {
    return null;
  }
  if (!scripts.some((script) => pathname.endsWith(`/node_modules/${script}`))) return null;
  if (pathname.startsWith('/@fs/')) return path.resolve(pathname.slice('/@fs'.length));
  const resolvedRoot = path.resolve(root);
  const file = path.resolve(resolvedRoot, `.${pathname}`);
  if (!file.startsWith(`${resolvedRoot}${path.sep}`)) return null;
  return file;
}

export function devRawClassicScripts(scripts = RAW_CLASSIC_SCRIPTS) {
  return {
    name: 'dev-raw-classic-scripts',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const file = rawClassicScriptFile(req.url, server.config.root, scripts);
        if (!file) return next();
        fs.readFile(file, (error, body) => {
          if (error) return next();
          res.setHeader('Content-Type', 'text/javascript');
          res.setHeader('Cache-Control', 'no-cache');
          res.end(body);
        });
      });
    },
  };
}
