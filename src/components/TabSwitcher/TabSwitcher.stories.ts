import type { Args, Meta, StoryObj } from '@storybook/vue3-vite'
import { ref } from 'vue'
import TabSwitcher from './TabSwitcher.vue'

type Story = StoryObj<typeof TabSwitcher>

const meta: Meta<typeof TabSwitcher> = {
  title: 'Layout/Notch',
  component: TabSwitcher,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The raised editor-notch used for document-level type selection. It preserves label width across selections and draws its browser-tab shoulders in real pixels.',
      },
    },
  },
  argTypes: {
    modelValue: {
      control: 'select',
      options: ['sequence', 'mermaid', 'plantuml'],
      description: 'The currently selected tab value (v-model)',
    },
    options: {
      description: 'Array of tab objects, each with `value` and `label`',
    },
    'onUpdate:modelValue': { action: 'update:modelValue' },
  },
}

export default meta

const ALL_OPTIONS = [
  { value: 'sequence', label: 'Sequence' },
  { value: 'mermaid',  label: 'Mermaid'  },
  { value: 'plantuml', label: 'PlantUML' },
]

/** All three diagram-type tabs — Sequence selected. */
export const SequenceActive: Story = {
  render: (args: Args) => ({
    components: { TabSwitcher },
    setup() {
      const current = ref(args.modelValue)
      return { args, current }
    },
    template: '<TabSwitcher :options="args.options" v-model="current" />',
  }),
  args: {
    modelValue: 'sequence',
    options: ALL_OPTIONS,
  },
}

/** All three diagram-type tabs — Mermaid selected. */
export const MermaidActive: Story = {
  render: (args: Args) => ({
    components: { TabSwitcher },
    setup() {
      const current = ref(args.modelValue)
      return { args, current }
    },
    template: '<TabSwitcher :options="args.options" v-model="current" />',
  }),
  args: {
    modelValue: 'mermaid',
    options: ALL_OPTIONS,
  },
}

/** All three diagram-type tabs — PlantUML selected. */
export const PlantUmlActive: Story = {
  render: (args: Args) => ({
    components: { TabSwitcher },
    setup() {
      const current = ref(args.modelValue)
      return { args, current }
    },
    template: '<TabSwitcher :options="args.options" v-model="current" />',
  }),
  args: {
    modelValue: 'plantuml',
    options: ALL_OPTIONS,
  },
}

/** Two-tab configuration — useful when PlantUML is disabled or not yet available. */
export const TwoTabs: Story = {
  render: (args: Args) => ({
    components: { TabSwitcher },
    setup() {
      const current = ref(args.modelValue)
      return { args, current }
    },
    template: '<TabSwitcher :options="args.options" v-model="current" />',
  }),
  args: {
    modelValue: 'sequence',
    options: [
      { value: 'sequence', label: 'Sequence' },
      { value: 'mermaid',  label: 'Mermaid'  },
    ],
  },
}

/** Single-tab degenerate case — still renders, tab is always active. */
export const SingleTab: Story = {
  render: (args: Args) => ({
    components: { TabSwitcher },
    setup() {
      const current = ref(args.modelValue)
      return { args, current }
    },
    template: '<TabSwitcher :options="args.options" v-model="current" />',
  }),
  args: {
    modelValue: 'sequence',
    options: [{ value: 'sequence', label: 'Sequence' }],
  },
}

/** Interactive story — clicking any tab updates the selection live. */
export const Interactive: Story = {
  render: () => ({
    components: { TabSwitcher },
    setup() {
      const current = ref('mermaid')
      return { current, options: ALL_OPTIONS }
    },
    template: `
      <div style="display: flex; flex-direction: column; gap: 12px; align-items: flex-start;">
        <TabSwitcher :options="options" v-model="current" />
        <p style="font-size: 13px; color: #6b7280; margin: 0;">
          Selected: <strong>{{ current }}</strong>
        </p>
      </div>
    `,
  }),
}

/** Embedded in a realistic header toolbar context. */
export const InHeaderToolbar: Story = {
  render: () => ({
    components: { TabSwitcher },
    setup() {
      const current = ref('sequence')
      return { current, options: ALL_OPTIONS }
    },
    template: `
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; width: 480px;">
        <span style="font-size: 14px; font-weight: 600; color: #172b4d;">Diagram Editor</span>
        <TabSwitcher :options="options" v-model="current" />
      </div>
    `,
  }),
}
