import { defineConfig } from 'wxt'
import { LOCAL_HOST_ORIGIN } from '@zenuml/pr-panel-shared'

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: '.',
  outDir: '.output',
  modules: ['@wxt-dev/module-vue'],
  manifest: {
    name: 'ZenUML PR Agent Panel',
    description:
      'Shows completed AI reviews beside GitHub pull requests and connects the page to your local Claude Code or Codex session.',
    permissions: ['storage', 'tabs'],
    host_permissions: ['https://github.com/*'],
    optional_host_permissions: [LOCAL_HOST_ORIGIN],
    minimum_chrome_version: '116',
    options_ui: { page: 'options.html', open_in_tab: true },
    action: { default_title: 'ZenUML PR Agent Panel', default_popup: 'popup.html' },
  },
})
