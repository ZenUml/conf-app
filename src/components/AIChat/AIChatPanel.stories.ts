import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { expect, userEvent, within } from 'storybook/test'
import AIChatPanel from './AIChatPanel.vue'
import type { AIChatMessage } from './aiChatPrototype'

const sequenceCode = [
  'Client -> Checkout: submit order',
  'Checkout -> Payment: charge card',
  'Payment --> Checkout: payment accepted',
  'Checkout --> Client: order confirmed',
].join('\n')

const appliedMessages: AIChatMessage[] = [
  {
    id: 'story-user-1',
    role: 'user',
    text: 'Add a timeout path after the payment request',
  },
  {
    id: 'story-assistant-1',
    role: 'assistant',
    text: '',
    preview: {
      title: 'Changes applied',
      kind: 'request',
      items: [
        'Added a payment timeout path while preserving the success flow.',
        'Returned a clear retry message to the client.',
      ],
      diffLocation: 'diagram.zenuml · payment flow',
      diffLines: [
        { type: 'context', code: 'Checkout -> Payment: charge card' },
        { type: 'context', code: 'Payment --> Checkout: payment accepted' },
        { type: 'add', code: 'Payment --> Checkout: payment timeout' },
        { type: 'add', code: 'Checkout --> Client: retry payment' },
        { type: 'context', code: 'Checkout --> Client: order confirmed' },
      ],
    },
  },
]

const errorMessages: AIChatMessage[] = [
  {
    id: 'story-user-error',
    role: 'user',
    text: 'Group the payment calls into a retry block',
  },
  {
    id: 'story-assistant-error',
    role: 'assistant',
    text: 'AI Chat could not apply the change: The generated diagram was not valid.',
  },
]

const meta: Meta<typeof AIChatPanel> = {
  title: 'AI Chat/AIChatPanel',
  component: AIChatPanel,
  tags: ['autodocs'],
  args: {
    open: true,
    codeVisible: false,
    diagramType: 'sequence',
    currentCode: sequenceCode,
    diagramTitle: 'Checkout flow',
    syntaxError: '',
    syntaxRepairRequestId: 0,
    diagramlyDiagramId: '',
    initialMessages: [],
  },
  argTypes: {
    syntaxRepairRequestId: { control: false },
    diagramlyDiagramId: { control: false },
    initialMessages: { control: false },
  },
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'AI diagram editing side panel used by the Vue diagram editors. The stories mount the real component without a Forge or Diagramly connection, so suggestion selection, composer state, diff review, syntax feedback, and error presentation stay reproducible. The surrounding shell mirrors the 368px editor panel beside the warm-cream diagram canvas.',
      },
    },
  },
  decorators: [
    () => ({
      template: `
        <div style="height:720px;display:flex;overflow:hidden;background:#F8F7F4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif">
          <div style="width:368px;min-width:368px;height:100%;border-right:1px solid #DFE1E6;background:#FFFFFF;box-shadow:0 1px 3px rgba(0,0,0,0.06)">
            <story />
          </div>
          <div style="min-width:0;flex:1;padding:32px;background-color:#F8F7F4;background-image:radial-gradient(circle,#D0CEC7 1px,transparent 1px);background-size:20px 20px">
            <div style="height:100%;display:grid;place-items:center;border:1px solid #E5E7EB;border-radius:8px;background:rgba(255,255,255,0.82);color:#6B7280;font-size:13px">
              Diagram preview
            </div>
          </div>
        </div>
      `,
    }),
  ],
}

export default meta

type Story = StoryObj<typeof AIChatPanel>

export const Empty: Story = {
  name: 'Empty — suggestions and composer',
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('What would you like to change?')).toBeVisible()
    const send = canvas.getByRole('button', { name: 'Send message' })
    await expect(send).toBeDisabled()

    await userEvent.click(canvas.getByRole('button', { name: /Add an error handling path/ }))
    await expect(canvas.getByRole('textbox', { name: 'AI change request' }))
      .toHaveValue('Add an error handling path')
    await expect(send).toBeEnabled()
  },
}

export const SyntaxIssue: Story = {
  name: 'Syntax issue — recovery action',
  args: {
    syntaxError: "Sequence syntax error at line 2: unexpected ')'",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('status')).toHaveTextContent('Syntax issue')
    await expect(canvas.getByRole('button', { name: 'Fix syntax' })).toBeEnabled()
  },
}

export const ChangeApplied: Story = {
  name: 'Change applied — code diff',
  args: {
    initialMessages: appliedMessages,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Changes applied')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'View code diff' }))
    await expect(canvas.getByTestId('ai-chat-diff')).toBeVisible()
    await expect(canvas.getByText('Payment --> Checkout: payment timeout')).toBeVisible()
  },
}

export const OpenAPIAssistant: Story = {
  name: 'OpenAPI — applied response update',
  args: {
    diagramType: 'openapi',
    currentCode: 'openapi: 3.0.0\ninfo:\n  title: Checkout API',
    diagramTitle: 'Checkout API',
    initialMessages: [
      {
        id: 'story-openapi-user',
        role: 'user',
        text: 'Document the 504 response',
      },
      {
        id: 'story-openapi-assistant',
        role: 'assistant',
        text: '',
        preview: {
          title: 'Changes applied',
          kind: 'request',
          items: ['Added a documented timeout response to the checkout endpoint.'],
          diffLocation: 'openapi.yaml · responses',
          diffLines: [
            { type: 'context', code: 'responses:' },
            { type: 'add', code: '  "504":' },
            { type: 'add', code: '    description: Upstream timeout' },
          ],
        },
      },
    ],
  },
}

export const RequestFailed: Story = {
  name: 'Request failed — recoverable error',
  args: {
    initialMessages: errorMessages,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/could not apply the change/)).toBeVisible()
    await expect(canvas.getByRole('textbox', { name: 'AI change request' })).toBeEnabled()
  },
}
