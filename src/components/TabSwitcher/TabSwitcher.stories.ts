import type { Args, Meta, StoryObj } from '@storybook/vue3-vite'
import { ref } from 'vue'
import TabSwitcher from './TabSwitcher.vue'

type Story = StoryObj<typeof TabSwitcher>

const meta: Meta<typeof TabSwitcher> = {
  title: 'Shared/TabSwitcher',
  component: TabSwitcher,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Diagram-type tab strip that sits in the editor Header\'s centre notch (Sequence / Mermaid / PlantUML). Each tab is a coloured dot plus a label, with an underline accent on the active tab; labels are visually hidden below the lg breakpoint (sr-only lg:not-sr-only), so at narrow widths only the dots show. Selecting a tab writes zenuml-preferred-diagram-type to localStorage.',
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

/** Two options. Not a production configuration — getEditorDiagramOptions() always returns all three types — kept to show the strip's sizing with fewer tabs. */
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

/** One option, always active. Not a production configuration either; the viewer's fullscreen type chip imitates this single-active-tab look without the switching behaviour (see GenericViewer.vue). */
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
