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

// Deterministic fixture: 200 operations, 200 schemas and one Path Item reference.
// Keep it identical when comparing Swagger UI versions.
const largeSpec = {
  openapi: '3.1.0', info: { title: 'Large Orders API', version: '1.0.0' },
  paths: {
    ...Object.fromEntries(Array.from({ length: 200 }, (_, i) => [
      `/orders/${i}`, { get: { summary: `Get order ${i}`, responses: { '200': { description: 'OK' } } } },
    ])),
    '/reference-check': { $ref: '#/components/pathItems/ReferencedOrder' },
  },
  components: {
    pathItems: { ReferencedOrder: { get: { summary: 'Referenced operation', responses: { '200': { description: 'OK' } } } } },
    schemas: Object.fromEntries(Array.from({ length: 200 }, (_, i) => [
      `Order${i}`, { type: 'object', properties: { id: { type: 'string' }, amount: { type: 'number' } } },
    ])),
  },
}
export const Large: Story = { args: { doc: { code: JSON.stringify(largeSpec) }, hideHeader: true } }
