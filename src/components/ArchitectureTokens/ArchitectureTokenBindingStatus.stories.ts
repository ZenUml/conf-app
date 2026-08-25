import { setup, type Meta, type StoryObj } from '@storybook/vue3-vite'
import { expect, within } from 'storybook/test'
import type { App } from 'vue'
import mixpanel from 'mixpanel-browser'
import { DiagramType, NULL_DIAGRAM } from '@/model/Diagram/Diagram'
import store from '@/model/store2'
import ArchitectureTokenBindingStatus from './ArchitectureTokenBindingStatus.vue'

type Story = StoryObj<typeof ArchitectureTokenBindingStatus>

const source = 'flowchart TD\n  A[Start] --> B[Review]'

// `setup()` installs Vuex on Storybook's actual root app. A decorator-level
// `app.use()` is not honored by this Storybook/Vue integration.
setup((app: App) => {
  app.use(store)
})

// Storybook intentionally has no Mixpanel token. Keep the visual fixture
// deterministic and console-clean without changing the product analytics path.
const noop = () => {}
;(mixpanel as any).init = noop
;(mixpanel as any).register = noop
;(mixpanel as any).track = noop

function present(readState: unknown) {
  store.state.diagram = {
    ...NULL_DIAGRAM,
    diagramType: DiagramType.Mermaid,
    mermaidCode: source,
    architectureTokenBindingReadState: readState as any,
  }
}

const meta: Meta<typeof ArchitectureTokenBindingStatus> = {
  title: 'Architecture Tokens/Binding evidence',
  component: ArchitectureTokenBindingStatus,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Read-only Mermaid binding evidence. It shows only closed outcome categories, never diagram source, identifiers, hashes, labels, or tokens.',
      },
    },
  },
  decorators: [
    () => ({
      template: '<div class="min-h-56 bg-slate-50 px-8 py-12"><div class="mx-auto max-w-2xl rounded-lg bg-white py-4 shadow-sm"><story /></div></div>',
    }),
  ],
}

export default meta

export const CurrentEvidence: Story = {
  decorators: [() => {
    present({ kind: 'available' })
    return { template: '<story />' }
  }],
  play: async () => {
    const body = within(document.body)
    await expect(await body.findByText('Architecture Token evidence available')).toBeVisible()
  },
}

export const ReconciliationNeedsReview: Story = {
  decorators: [() => {
    present({
      kind: 'available',
      reconciliationHistory: [{
        outcome: 'unresolved',
        categories: ['ambiguous_structure', 'candidate_unresolved'],
      }],
    })
    return { template: '<story />' }
  }],
  play: async () => {
    const body = within(document.body)
    await expect(await body.findByText('Saved outcome: needs human confirmation')).toBeVisible()
    await expect(await body.findByText('Ambiguous structure')).toBeVisible()
  },
}

export const StaleEvidence: Story = {
  decorators: [() => {
    present({ kind: 'stale', reason: 'source_hash_mismatch' })
    return { template: '<story />' }
  }],
  play: async () => {
    const body = within(document.body)
    await expect(await body.findByText('Architecture Token evidence needs review')).toBeVisible()
  },
}

export const UntrustedEvidence: Story = {
  decorators: [() => {
    present({ kind: 'untrusted', reason: 'invalid_state' })
    return { template: '<story />' }
  }],
  play: async () => {
    const body = within(document.body)
    await expect(await body.findByText('Architecture Token evidence unavailable')).toBeVisible()
  },
}
