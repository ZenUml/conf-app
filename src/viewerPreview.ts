import './assets/tailwind.css'
import { createApp, h } from 'vue'
import store from '@/model/store2'
import GenericViewer from '@/components/Viewer/GenericViewer.vue'
import EventBus from '@/EventBus'
import { getContext } from '@/model/globals/forgeGlobal'
import { getPresetById } from '@/sandbox/presets'

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

  await getContext()

  // Seed the store from the preset. Without a diagram type the viewer hides
  // everything gated on one — Source, the Copy for AI split button, the
  // fullscreen type chip — so the harness rendered chrome no real macro shows.
  const preset = getPresetById(params.get('sandbox') ?? 'seq-view')
  if (preset) {
    store.commit('updateDiagramType', preset.diagramType)
    store.commit('updateTitle', 'build_router_graph')
    store.commit('updateCode2', 'Actor->Service.getorder() {\n  Controller.sendMessage(sss)\n}\n')
    store.state.viewerLoadState = 'ready'
  }

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
