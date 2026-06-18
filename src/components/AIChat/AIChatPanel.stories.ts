import type { Meta, StoryObj } from '@storybook/vue3-vite'
import AIChatPanel from './AIChatPanel.vue'

type Story = StoryObj<typeof AIChatPanel>

const meta: Meta<typeof AIChatPanel> = {
  title: 'AI/AIChatPanel',
  component: AIChatPanel,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Guided AI diagram editing with explicit understanding, update, review, and apply states.',
      },
    },
  },
  decorators: [
    () => ({
      template:
        '<div class="border-r border-slate-200 shadow-lg" style="width: min(368px, 94vw); height: 100vh"><story /></div>',
    }),
  ],
}

export default meta

export const Empty: Story = {
  args: {
    open: true,
    diagramType: 'sequence',
    prototypeMode: true,
  },
}

export const Mermaid: Story = {
  args: {
    open: true,
    diagramType: 'mermaid',
    prototypeMode: true,
  },
}

export const ChangeReady: Story = {
  args: {
    open: true,
    diagramType: 'sequence',
    prototypeMode: true,
    initialMessages: [
      {
        id: 'user-ready',
        role: 'user',
        text: 'Add an error handling path',
      },
      {
        id: 'assistant-ready',
        role: 'assistant',
        text: 'I prepared a focused update that keeps the current diagram structure intact.',
        preview: {
          title: 'Changes applied',
          items: [
            'Added failure and timeout paths while preserving the existing success flow.',
          ],
          diffLocation: 'diagram.zenuml · error path',
          diffLines: [
            { type: 'context', code: 'Payment.charge()' },
            { type: 'add', code: 'Payment -> Checkout: "payment failed"' },
            { type: 'add', code: 'Payment -> Checkout: "payment timeout"' },
          ],
          versionId: 2,
          previousVersionId: 1,
        },
      },
    ],
  },
}

export const WithSyntaxIssue: Story = {
  args: {
    open: true,
    diagramType: 'sequence',
    syntaxError:
      "Sequence syntax error: at line 12, column 21: no viable alternative at input '.1post('",
    prototypeMode: true,
  },
}
