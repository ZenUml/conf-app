import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mergeConfig, type UserConfig } from 'vite'
import type { StorybookConfig } from '@storybook/vue3-vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(js|jsx|mjs|ts|tsx)'],
  addons: ['@storybook/addon-docs', '@storybook/addon-a11y'],
  framework: {
    name: '@storybook/vue3-vite',
    options: {},
  },
  viteFinal: async (baseConfig) => {
    return mergeConfig(baseConfig, {
      define: {
        'import.meta.env.PRODUCT_TYPE': JSON.stringify(process.env.PRODUCT_TYPE || 'lite'),
        'import.meta.env.VITE_APP_VERSION': JSON.stringify('storybook'),
        'import.meta.env.VITE_APP_COMMIT': JSON.stringify('storybook'),
        'import.meta.env.VITE_MIXPANEL_TOKEN': JSON.stringify(''),
      },
      resolve: {
        alias: {
          vue: '@vue/compat',
          '@': path.resolve(__dirname, '../src'),
        },
        dedupe: ['vue', '@vue/compat'],
      },
    } satisfies UserConfig)
  },
}

export default config
