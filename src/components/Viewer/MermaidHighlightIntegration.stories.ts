// @ts-expect-error -- Storybook package exports resolve through Vite
import { setup, type Meta, type StoryObj } from '@storybook/vue3-vite'
import DiagramPortal from '@/components/DiagramPortal.vue'
import store from '@/model/store2'
import { configureHighlightStoreAndFlags, highlightForgeEnv, primeHighlightMermaid } from './fixtures/mermaidHighlightStory'
import { PI_MAGIC_SYNTHETIC_ARTIFACT, PI_MAGIC_SYNTHETIC_SOURCE } from './fixtures/piMagicSynthetic'
import { expect, userEvent, waitFor, within } from 'storybook/test'
setup(app => app.use(store))
function configureIntegration() {
  configureHighlightStoreAndFlags()
  store.commit('updateTitle', 'Order processing')
  store.commit('updateMermaidCode', 'flowchart LR\n  Cart-->Order\n  Order-->Inventory\n  Order-->Payment\n  Order-->Record\n  Inventory-->Event\n  Inventory-->Warehouse\n  Payment-->Event\n  Payment-->Warehouse\n  Record-->Event\n  Record-->Customer')
}
const meta: Meta<typeof DiagramPortal> = {
  title: 'Viewer/MermaidHighlightIntegration',
  component: DiagramPortal,
  parameters: { layout: 'fullscreen' },
  loaders: [async () => { await primeHighlightMermaid(); return {} }],
  decorators: [() => ({ template: '<div style="padding:24px"><story /></div>' })],
}
export default meta
type Story = StoryObj<typeof DiagramPortal>
export const Inline: Story = {
  args: { autoResize: true },
  decorators: [highlightForgeEnv({ inline: true }), () => { configureIntegration(); return { template: '<story />' } }],
}
/** The staged header shows a valid refined layout inline; hovering it highlights relationships. */
export const InlineRefined: Story = {
  args: { autoResize: true },
  decorators: [highlightForgeEnv({ inline: true }), () => {
    configureIntegration()
    store.commit('updateMermaidCode', PI_MAGIC_SYNTHETIC_SOURCE)
    ;(store.state as any).diagram.magic = PI_MAGIC_SYNTHETIC_ARTIFACT
    return { template: '<story />' }
  }],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getByTestId('magic-toggle')).toHaveAttribute('aria-pressed', 'true'))
    const node = await waitFor(() => { const hit = canvasElement.querySelector('[data-hit-node]'); expect(hit).not.toBeNull(); return hit! })
    const svg = node.closest('svg')!
    // Refined replaces the original canvas, so this is the only interactive drawing.
    await expect(canvasElement.querySelectorAll('svg:has([data-hit-node])')).toHaveLength(1)
    await userEvent.hover(node)
    await waitFor(() => expect(svg.classList.contains('focus-on')).toBe(true))
  },
}
export const Fullscreen: Story = { args: { autoResize: false }, decorators: [highlightForgeEnv(), () => { configureIntegration(); return { template: '<story />' } }] }
export const UnsupportedSequence: Story = {
  decorators: [highlightForgeEnv(), () => { configureIntegration(); store.commit('updateMermaidCode', 'sequenceDiagram\n  Client->>Server: Request\n  Server-->>Client: Response'); return { template: '<story />' } }],
}
export const Preview: Story = { args: { hideHeader: true, readOnly: true }, decorators: [highlightForgeEnv(), () => { configureIntegration(); return { template: '<story />' } }] }
