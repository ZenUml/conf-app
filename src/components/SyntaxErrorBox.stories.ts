import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { within, expect } from 'storybook/test'
import SyntaxErrorBox from './SyntaxErrorBox.vue'
import store from '@/model/store2'

type Story = StoryObj<typeof SyntaxErrorBox>

function setError(error: string | null) {
  store.dispatch('updateError', error)
}

const meta: Meta<typeof SyntaxErrorBox> = {
  title: 'Feedback/SyntaxErrorBox',
  component: SyntaxErrorBox,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Sticky bottom bar that displays a syntax error from the Vuex store. Renders nothing when the store has no error. Includes an AI Repair button that requests AI Chat syntax repair when the feature flag is enabled.',
      },
    },
  },
  decorators: [
    (_story: unknown, context: { app?: { use: (plugin: unknown) => void } }) => {
      // Install the Vuex store plugin so useStore() resolves inside the component.
      context.app?.use(store)
      return {
        template: '<div class="relative h-64 bg-slate-50 flex flex-col"><div class="flex-1" /><story /></div>',
      }
    },
  ],
}

export default meta

/** No error in the store — the component renders nothing. */
export const Empty: Story = {
  decorators: [
    () => {
      setError(null)
      return { template: '<story />' }
    },
  ],
  play: async () => {
    const body = within(document.body)
    await expect(body.queryByText('Syntax error')).toBeNull()
  },
}

/** A single-line syntax error message. */
export const SingleError: Story = {
  decorators: [
    () => {
      setError('Unexpected token at line 3, column 12')
      return { template: '<story />' }
    },
  ],
  play: async () => {
    const body = within(document.body)
    await expect(await body.findByText('Syntax error')).toBeVisible()
    await expect(await body.findByText(/Unexpected token at line 3/)).toBeVisible()
  },
}

/** A multi-line error string that stresses the scrollable output area. */
export const MultiLineError: Story = {
  decorators: [
    () => {
      setError(
        [
          "Parse error: Unexpected token '<' at line 1, column 0",
          'Expected one of: participant, actor, title, autonumber, loop, alt, opt, par, critical, break',
          'Hint: Make sure every participant name is quoted if it contains spaces.',
          'Stack trace:',
          '  at Parser.parse (parser.js:142)',
          '  at Diagram.render (diagram.js:88)',
        ].join('\n'),
      )
      return { template: '<story />' }
    },
  ],
  play: async () => {
    const body = within(document.body)
    await expect(await body.findByText('Syntax error')).toBeVisible()
    await expect(await body.findByText(/Parse error/)).toBeVisible()
  },
}
