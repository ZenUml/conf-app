import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { expect, userEvent, within } from 'storybook/test'
import EditorMcpPromo from './EditorMcpPromo.vue'

// The promo reads the shared frequency state (mcpPromo.ts); reset it so every
// story starts as a first visit.
function freshVisit() {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('zenuml.mcpPromo') || key.startsWith('zenuml.connectMcpShown')) localStorage.removeItem(key)
  }
  sessionStorage.removeItem('zenuml.mcpPromo.session')
}

const meta: Meta<typeof EditorMcpPromo> = {
  title: 'Shared/EditorMcpPromo',
  component: EditorMcpPromo,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'MCP promo for the Graph, OpenAPI and AsyncAPI editors: the new-diagram card and the typing tip float in one corner over the editor, with the Connect MCP dialog. Same rules as Workspace (useEditorMcpPromo).',
      },
    },
  },
  decorators: [
    () => {
      freshVisit()
      return { template: '<div style="height: 640px; background: #f4f5f7;"><story /></div>' }
    },
  ],
}
export default meta

type Story = StoryObj<typeof EditorMcpPromo>

const opensDialog: Story['play'] = async ({ args }) => {
  const body = within(document.body)
  const cta = await body.findByTestId('mcp-promo-card-cta')
  await expect(body.getByText('Start from your code')).toBeVisible()
  await userEvent.click(cta)
  await expect(await body.findByText(/Add the ZenUML MCP server/)).toBeVisible()
  const article = /^[aeiou]/i.test(args.diagramType === 'graph' ? 'draw.io' : args.diagramType) ? 'an' : 'a'
  await expect(body.getByText(new RegExp(`help me draw ${article} `))).toBeInTheDocument()
}

export const GraphNewDiagram: Story = {
  name: 'Graph editor — new diagram',
  args: { diagramType: 'graph', code: '', insetSide: 264, insetBottom: 48 },
  play: opensDialog,
}

export const OpenApiNewDiagram: Story = {
  name: 'OpenAPI editor — new spec',
  args: { diagramType: 'OpenAPI', code: 'openapi: 3.0.0' },
  play: opensDialog,
}

export const AsyncApiNewDiagram: Story = {
  name: 'AsyncAPI editor — new spec',
  args: { diagramType: 'AsyncAPI', code: 'asyncapi: 3.0.0' },
  play: opensDialog,
}

export const SavedDiagram: Story = {
  name: 'Saved diagram — no new-diagram card',
  args: { diagramType: 'OpenAPI', code: 'openapi: 3.0.0', diagramId: '42' },
  play: async () => {
    await new Promise((r) => setTimeout(r, 500))
    await expect(within(document.body).queryByTestId('mcp-promo-card')).toBeNull()
  },
}
