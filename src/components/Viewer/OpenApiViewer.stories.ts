import { setup, type Meta, type StoryObj } from '@storybook/vue3-vite'
import OpenApiViewer from './OpenApiViewer.vue'
import store from '@/model/store2'

setup(app => app.use(store))

const meta: Meta = { title: 'Viewer/OpenAPI', component: OpenApiViewer, parameters: { layout: 'fullscreen' } }
export default meta
type Story = StoryObj<typeof meta>

const spec = {
  openapi: '3.0.3', info: { title: 'Orders API', version: '1.0.0' },
  paths: { '/orders': { get: { summary: 'List orders', responses: { '200': { description: 'OK' } } } } },
  components: { schemas: { Order: { type: 'object', properties: { id: { type: 'string' } } } } },
}
export const Small: Story = { args: { doc: { code: JSON.stringify(spec) }, hideHeader: true } }
