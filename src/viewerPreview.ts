import './assets/tailwind.css'
import { installSandboxRuntime } from '@/sandbox/runtime'

async function bootstrap() {
  const params = new URLSearchParams(location.search)
  if (!params.has('sandbox')) {
    const url = new URL(location.href)
    url.searchParams.set('sandbox', 'seq-view')
    history.replaceState(null, '', url.toString())
  }

  const noBlock = params.get('noBlock') === '1'
  localStorage.mockCSSEnabled = 'true'
  localStorage.mockMacroCount = noBlock ? '60' : '120'
  localStorage.mockSpacePaid = 'false'

  installSandboxRuntime()

  const [
    { createApp, h },
    { default: store },
    { default: GenericViewer },
    { default: EventBus },
  ] = await Promise.all([
    import('vue'),
    import('@/model/store2'),
    import('@/components/Viewer/GenericViewer.vue'),
    import('@/EventBus'),
  ])

  ;(window as any).__editFiredCount = 0
  EventBus.$on('edit', () => {
    ;(window as any).__editFiredCount += 1
  })

  createApp({
    render() {
      return h(
        GenericViewer,
        { wide: false },
        {
          default: () =>
            h(
              'div',
              { class: 'p-8 text-gray-500 text-sm' },
              'GenericViewer SPA preview — diagram slot placeholder'
            ),
        }
      )
    },
  })
    .use(store)
    .mount('#app')
}

void bootstrap()
