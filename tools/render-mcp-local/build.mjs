// Bundle the local stdio server into one Node ESM file, dist/cli.mjs.
//
// Our own code (this package plus the shared functions/agent-link modules) is
// bundled. The parsers are left as runtime dependencies (package.json), so the
// published file stays small and npm installs them once.
import { chmod, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const external = Object.keys(pkg.dependencies ?? {});

await build({
  configFile: false,
  root,
  logLevel: 'warn',
  define: { __PACKAGE_VERSION__: JSON.stringify(pkg.version) },
  build: {
    ssr: resolve(root, 'src/cli.ts'),
    outDir: resolve(root, 'dist'),
    emptyOutDir: true,
    target: 'node20',
    minify: false,
    rollupOptions: {
      external: (id) => external.some((dep) => id === dep || id.startsWith(`${dep}/`)) || id.startsWith('node:'),
      output: { format: 'es', entryFileNames: 'cli.mjs', banner: '#!/usr/bin/env node', inlineDynamicImports: true },
    },
  },
  ssr: { noExternal: true },
});
await chmod(resolve(root, 'dist/cli.mjs'), 0o755);
console.log(`built ${resolve(root, 'dist/cli.mjs')}`);
