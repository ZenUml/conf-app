import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { expect, within } from 'storybook/test'
import AsyncApiDashboard from './AsyncApiDashboard.vue'
import globals from '@/model/globals'
import forgeGlobal from '@/model/globals/forgeGlobal'

/**
 * The AsyncAPI variant's "My API Documents" space page. The REAL component is
 * mounted; globals.apWrapper.searchCustomContent / getCurrentSpace are shadowed
 * on the singleton (same technique as DocumentList.stories.ts), so nothing
 * reaches Forge or Confluence. Rows go through toSpecDocument, so this story
 * shows what the dashboard (and the embed picker, for AsyncAPI) derive from
 * the stored specs: format badge, title precedence, and the count pills.
 */
const OPENAPI3 = `openapi: 3.0.3
info:
  title: Pets API
  version: 1.2.0
  description: Pet store
paths:
  /pets:
    get: {}
    post: {}
  /pets/{id}:
    parameters: []
    delete: {}
`
const ASYNC2 = `asyncapi: 2.6.0
info:
  title: Street Lights
  version: 0.1.0
  description: Street light measurements
channels:
  light/measured: {}
  light/turn: {}
servers:
  prod: {}
`
const ASYNC3 = `asyncapi: 3.0.0
info:
  title: Orders (v3)
  version: 3.0.1
channels:
  orders: {}
  payments: {}
  shipments: {}
`

const ITEMS = [
  { id: '1001', space: { key: 'DOCS' }, version: { number: 3, createdAt: '2026-10-01T10:00:00Z' }, createdAt: '2026-09-01T10:00:00Z',
    value: { diagramType: 'OpenAPI', code: OPENAPI3 } },
  { id: '1002', space: { key: 'DOCS' }, version: { number: 1, createdAt: '2026-10-02T10:00:00Z' }, createdAt: '2026-10-02T10:00:00Z',
    value: { diagramType: 'AsyncAPI', code: ASYNC2 } },
  { id: '1003', space: { key: 'DOCS' }, version: { number: 5, createdAt: '2026-10-03T10:00:00Z' }, createdAt: '2026-08-01T10:00:00Z',
    value: { diagramType: 'AsyncAPI', code: ASYNC3 } },
  // No info.title and no custom-content title: falls back to "Untitled AsyncAPI".
  { id: '1004', space: { key: 'DOCS' }, version: { number: 1, createdAt: '2026-10-04T10:00:00Z' }, createdAt: '2026-10-04T10:00:00Z',
    value: { diagramType: 'AsyncAPI', code: 'asyncapi: 2.0.0\nchannels: {}\n' } },
]

function configureStory(items: unknown[]) {
  forgeGlobal.isForge = false
  forgeGlobal.isLite = true
  ;(globals.apWrapper as any).searchCustomContent = async () => items
  ;(globals.apWrapper as any).getCurrentSpace = async () => ({ key: 'DOCS' })
}

const meta: Meta<typeof AsyncApiDashboard> = {
  title: 'AsyncApi/AsyncApiDashboard',
  component: AsyncApiDashboard,
  parameters: { layout: 'fullscreen' },
}

export default meta

type Story = StoryObj<typeof AsyncApiDashboard>

/** OpenAPI 3, AsyncAPI 2, AsyncAPI 3 and one untitled spec. */
export const Populated: Story = {
  decorators: [
    () => {
      configureStory(ITEMS)
      return { template: '<story />' }
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('Pets API')).toBeVisible()
    await expect(canvas.getByText('Street Lights')).toBeVisible()
    await expect(canvas.getByText('Orders (v3)')).toBeVisible()
    await expect(canvas.getByText('Untitled AsyncAPI')).toBeVisible()
    await expect(canvas.getByText(/4 documents found/)).toBeVisible()
    await expect(canvas.getByText('2 paths')).toBeVisible()
    await expect(canvas.getByText('3 operations')).toBeVisible()
  },
}
