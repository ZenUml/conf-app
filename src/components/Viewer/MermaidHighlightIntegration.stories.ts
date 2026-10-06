// @ts-expect-error -- Storybook package exports resolve through Vite
import { setup, type Meta, type StoryObj } from '@storybook/vue3-vite'
import DiagramPortal from '@/components/DiagramPortal.vue'
import store from '@/model/store2'
import forgeGlobal from '@/model/globals/forgeGlobal'
import { configureHighlightStory, primeHighlightMermaid } from './fixtures/mermaidHighlightStory'
setup(app => app.use(store))
function configureIntegration() {
  configureHighlightStory()
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
  decorators: [() => { configureIntegration(); delete forgeGlobal.forgeContext.extension.modal; return { template: '<story />' } }],
}
export const Fullscreen: Story = { args: { autoResize: false }, decorators: [() => { configureIntegration(); return { template: '<story />' } }] }
export const UnsupportedSequence: Story = {
  decorators: [() => { configureIntegration(); store.commit('updateMermaidCode', 'sequenceDiagram\n  Client->>Server: Request\n  Server-->>Client: Response'); return { template: '<story />' } }],
}
export const Preview: Story = { args: { hideHeader: true, readOnly: true }, decorators: [() => { configureIntegration(); return { template: '<story />' } }] }
