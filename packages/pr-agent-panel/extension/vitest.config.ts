import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig, type UserConfig } from 'vitest/config'

const here = path.dirname(fileURLToPath(import.meta.url))

// Why not `WxtVitest()` from 'wxt/testing/vitest-plugin':
// WXT 0.21's plugin declares `resolveId` as an object hook with a `filter`
// (a Vite >= 6.3 feature). Vitest 2.1 runs on Vite 5.4, which ignores the
// filter and resolves *every* import to WXT's virtual setup module, so each
// spec fails with "No test suite found". This config reproduces the two parts
// of WxtVitest that the specs need: `wxt/browser` -> WXT's fake browser, and
// the global `browser`/`chrome` stubs (vitest.setup.ts). WxtVitest also does
// not add the Vue SFC compiler, so @vitejs/plugin-vue is listed explicitly.
export default defineConfig({
  // plugin-vue is typed against the repo's Vite 7; Vitest 2 runs Vite 5. The runtime hook shapes match.
  plugins: [vue() as unknown as NonNullable<UserConfig['plugins']>[number]],
  resolve: {
    alias: [
      { find: /^wxt\/browser$/, replacement: path.resolve(here, 'node_modules/wxt/dist/virtual/mock-browser.mjs') },
      { find: /^@\//, replacement: `${here}/` },
    ],
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.spec.ts', 'entrypoints/**/*.spec.ts'],
    setupFiles: ['./vitest.setup.ts'],
    server: { deps: { inline: ['@vue/test-utils', 'wxt'] } },
  },
})
