import { createLocalServer, resolveViewOrigin, serveStdio } from './server';

declare const __PACKAGE_VERSION__: string;

try {
  const handle = createLocalServer({
    viewOrigin: resolveViewOrigin(process.env.ZENUML_VIEW_ORIGIN),
    version: typeof __PACKAGE_VERSION__ === 'string' ? __PACKAGE_VERSION__ : '0.0.0',
  });
  await serveStdio(handle);
} catch (e) {
  process.stderr.write(`zenuml-render-mcp: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
}
