import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    env: { PR_PANEL_LOG_LEVEL: 'silent' },
  },
})
