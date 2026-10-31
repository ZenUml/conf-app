import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { setup } from '@storybook/vue3-vite'
import { expect, waitFor } from 'storybook/test'
import Mermaid from '@/components/Mermaid.vue'
import store from '@/model/store2'
import { DiagramType } from '@/model/Diagram/Diagram'
import { loadMermaid } from '@/utils/mermaid/loadMermaid'
import { validateMermaidSyntax } from '@/utils/mermaid/validate'

setup((app) => {
  app.use(store)
})

// Mermaid's `default` theme fills nodes with #ECECFF; the `neutral` theme the
// renderer configures does not. Before #931 the editor's syntax validator reset
// the shared config, so the preview switched to `default` after one keystroke.
const DEFAULT_THEME_NODE_FILL = /#ececff/i

const meta: Meta = {
  title: 'Editor/Diagram/MermaidValidationTheme',
  parameters: { layout: 'fullscreen' },
}

export default meta
type Story = StoryObj<typeof meta>

export const PreviewKeepsNeutralThemeAfterValidation: Story = {
  render: () => ({
    components: { Mermaid },
    setup() {
      store.commit('updateDiagramType', DiagramType.Mermaid)
      store.commit('updateMermaidCode', 'flowchart TB\n  A["one"] --> B["two"]')
    },
    template: '<div style="width: 100%; height: 440px; padding: 24px; box-sizing: border-box;"><Mermaid /></div>',
  }),
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector('svg')).not.toBeNull(), { timeout: 10000 })

    // What Editor.vue does on every change, then the preview re-renders.
    const edited = 'flowchart TB\n  A["one"] --> B["two"] --> C["three"]'
    await expect(validateMermaidSyntax(edited)).resolves.toMatchObject({ valid: true })
    store.commit('updateMermaidCode', edited)

    await waitFor(() => expect(canvasElement.querySelector('svg')?.textContent).toContain('three'), { timeout: 10000 })
    const mermaid = await loadMermaid()
    await expect(mermaid.mermaidAPI.getConfig().theme).toBe('neutral')
    await expect(mermaid.mermaidAPI.getConfig().securityLevel).toBe('strict')
    await expect(canvasElement.querySelector('svg')!.innerHTML).not.toMatch(DEFAULT_THEME_NODE_FILL)
  },
}
