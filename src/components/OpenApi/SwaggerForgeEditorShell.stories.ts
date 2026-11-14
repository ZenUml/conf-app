// @ts-ignore — root tsconfig moduleResolution "node" cannot see @storybook/vue3-vite exports
import { setup, type Meta, type StoryObj } from '@storybook/vue3-vite'
import SwaggerForgeEditorShell from './SwaggerForgeEditorShell.vue'
import store from '@/model/store2'
import { DiagramType } from '@/model/Diagram/Diagram'
import forgeGlobal from '@/model/globals/forgeGlobal'
import OpenApiExample from '@/model/OpenApi/OpenApiExample'

setup((app: { use(plugin: typeof store): unknown }) => {
  app.use(store)
})

type Story = StoryObj<typeof SwaggerForgeEditorShell>

function configureOpenApiState({
  title = 'Sample API',
  code = OpenApiExample,
  error = null,
}: {
  title?: string
  code?: string
  error?: string | null
} = {}) {
  forgeGlobal.isForge = false
  forgeGlobal.zenumlRemoteBaseUrl = 'https://storybook.example.com'
  store.commit('updateDiagramType', DiagramType.OpenApi)
  store.commit('updateCode2', code)
  store.commit('updateTitle', title)
  store.commit('updateError', error)
  ;(window as any).specContent = code
  ;(window as any).diagram = {
    id: 'cc-openapi-1',
    diagramType: DiagramType.OpenApi,
    title,
    code,
  }
}

const meta: Meta<typeof SwaggerForgeEditorShell> = {
  title: 'Editor/Diagram/SwaggerForgeEditorShell',
  component: SwaggerForgeEditorShell,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Vue OpenAPI editor shell hosting OpenApiHeader (title input, AI Chat toggle, Help, Publish), the #swagger-editor container, and the child SyntaxErrorBox.',
      },
    },
  },
}

export default meta

export const DefaultHeader: Story = {
  decorators: [
    () => {
      configureOpenApiState({ title: 'Sample API', error: null })
      return { template: '<story />' }
    },
  ],
}

export const WithSyntaxError: Story = {
  decorators: [
    () => {
      configureOpenApiState({
        title: 'Pet Store API',
        error: 'YAML syntax error at line 12, column 11: mapping values are not allowed in this context',
      })
      return { template: '<story />' }
    },
  ],
}
