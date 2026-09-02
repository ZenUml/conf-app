import type { Meta, StoryObj } from '@storybook/vue3-vite'
import IconCloud from './IconCloud.vue'
import IconComputer from './IconComputer.vue'
import IconDismiss from './IconDismiss.vue'
import IconFile from './IconFile.vue'
import IconGitBranch from './IconGitBranch.vue'

type Story = StoryObj<typeof IconCloud>

const ALL_ICONS: { name: string; component: object }[] = [
  { name: 'IconCloud', component: IconCloud },
  { name: 'IconComputer', component: IconComputer },
  { name: 'IconDismiss', component: IconDismiss },
  { name: 'IconFile', component: IconFile },
  { name: 'IconGitBranch', component: IconGitBranch },
]

const meta: Meta<typeof IconCloud> = {
  title: 'Atoms/Icons',
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: 'All SVG icon components available in the conf-app icon library.',
      },
    },
  },
}

export default meta

/** Gallery — all icons displayed in a grid with their component names. */
export const Gallery: Story = {
  render: () => ({
    components: Object.fromEntries(ALL_ICONS.map(({ name, component }) => [name, component])),
    template: `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:16px;padding:8px;">
        <div
          v-for="icon in icons"
          :key="icon.name"
          style="display:flex;flex-direction:column;align-items:center;gap:8px;padding:12px;border:1px solid #e5e7eb;border-radius:8px;"
        >
          <component :is="icon.component" />
          <span style="font-size:11px;color:#6b7280;text-align:center;word-break:break-all;">{{ icon.name }}</span>
        </div>
      </div>
    `,
    setup() {
      return { icons: ALL_ICONS }
    },
  }),
}

// --- Individual icon stories ---

/** Cloud icon — indicates cloud storage or remote sync. */
export const Cloud: Story = {
  render: () => ({ template: '<IconCloud />', components: { IconCloud } }),
}

/** Computer icon — represents a local/desktop environment. */
export const Computer: Story = {
  render: () => ({ template: '<IconComputer />', components: { IconComputer } }),
}

/** Dismiss icon — close or clear action. */
export const Dismiss: Story = {
  render: () => ({ template: '<IconDismiss />', components: { IconDismiss } }),
}

/** File icon — represents a file or document. */
export const File: Story = {
  render: () => ({ template: '<IconFile />', components: { IconFile } }),
}

/** GitBranch icon — indicates version history or branching. */
export const GitBranch: Story = {
  render: () => ({ template: '<IconGitBranch />', components: { IconGitBranch } }),
}
