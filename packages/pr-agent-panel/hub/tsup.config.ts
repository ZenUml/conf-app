import { defineConfig, type Options } from 'tsup'

const common: Options = {
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  outExtension: () => ({ js: '.mjs' }),
  noExternal: ['@zenuml/pr-panel-shared'],
  sourcemap: true,
  splitting: false,
}

export default defineConfig([
  {
    ...common,
    entry: { cli: 'src/cli.ts' },
    clean: false,
    banner: { js: '#!/usr/bin/env node' },
  },
  {
    ...common,
    entry: { hub: 'src/hub.ts' },
    clean: false,
  },
])
