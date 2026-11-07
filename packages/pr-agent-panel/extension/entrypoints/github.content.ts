import '../src/ui/panel.css'
import '../src/ui/list.css'
import { defineContentScript } from 'wxt/utils/define-content-script'
import { createPageController } from '../src/content/controller'

export default defineContentScript({
  matches: ['https://github.com/*/*/pull/*', 'https://github.com/*/*/pulls*'],
  cssInjectionMode: 'ui',
  runAt: 'document_idle',
  async main(ctx) {
    await createPageController(ctx).start()
  },
})
