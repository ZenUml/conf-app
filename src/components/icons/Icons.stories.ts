import type { Meta, StoryObj } from '@storybook/vue3-vite'
import IconChevron from './IconChevron.vue'
import IconCloud from './IconCloud.vue'
import IconComputer from './IconComputer.vue'
import IconDismiss from './IconDismiss.vue'
import IconEdit from './IconEdit.vue'
import IconFile from './IconFile.vue'
import IconFullscreen from './IconFullscreen.vue'
import IconFullscreenOff from './IconFullscreenOff.vue'
import IconGitBranch from './IconGitBranch.vue'
import IconGrid from './IconGrid.vue'
import IconInfo from './IconInfo.vue'
import IconLike from './IconLike.vue'
import IconLikeFilled from './IconLikeFilled.vue'
import IconList from './IconList.vue'
import IconPencil from './IconPencil.vue'
import IconServer from './IconServer.vue'
import IconSpark from './IconSpark.vue'

type Story = StoryObj<typeof IconChevron>

const ALL_ICONS: { name: string; component: object }[] = [
  { name: 'IconChevron', component: IconChevron },
  { name: 'IconCloud', component: IconCloud },
  { name: 'IconComputer', component: IconComputer },
  { name: 'IconDismiss', component: IconDismiss },
  { name: 'IconEdit', component: IconEdit },
  { name: 'IconFile', component: IconFile },
  { name: 'IconFullscreen', component: IconFullscreen },
  { name: 'IconFullscreenOff', component: IconFullscreenOff },
  { name: 'IconGitBranch', component: IconGitBranch },
  { name: 'IconGrid', component: IconGrid },
  { name: 'IconInfo', component: IconInfo },
  { name: 'IconLike', component: IconLike },
  { name: 'IconLikeFilled', component: IconLikeFilled },
  { name: 'IconList', component: IconList },
  { name: 'IconPencil', component: IconPencil },
  { name: 'IconServer', component: IconServer },
  { name: 'IconSpark', component: IconSpark },
]

const meta: Meta<typeof IconChevron> = {
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

/** Chevron icon — directional indicator, used in dropdowns and accordions. */
export const Chevron: Story = {
  render: () => ({ template: '<IconChevron />', components: { IconChevron } }),
}

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

/** Edit icon — triggers edit mode on a diagram or content item. */
export const Edit: Story = {
  render: () => ({ template: '<IconEdit />', components: { IconEdit } }),
}

/** File icon — represents a file or document. */
export const File: Story = {
  render: () => ({ template: '<IconFile />', components: { IconFile } }),
}

/** Fullscreen icon — expands the viewer to fullscreen. */
export const Fullscreen: Story = {
  render: () => ({ template: '<IconFullscreen />', components: { IconFullscreen } }),
}

/** FullscreenOff icon — exits fullscreen mode. */
export const FullscreenOff: Story = {
  render: () => ({ template: '<IconFullscreenOff />', components: { IconFullscreenOff } }),
}

/** GitBranch icon — indicates version history or branching. */
export const GitBranch: Story = {
  render: () => ({ template: '<IconGitBranch />', components: { IconGitBranch } }),
}

/** Grid icon — switches to grid/gallery view layout. */
export const Grid: Story = {
  render: () => ({ template: '<IconGrid />', components: { IconGrid } }),
}

/** Info icon — displays contextual help or information. */
export const Info: Story = {
  render: () => ({ template: '<IconInfo />', components: { IconInfo } }),
}

/** Like icon (outline) — bookmark/save action, unfilled state. */
export const Like: Story = {
  render: () => ({ template: '<IconLike />', components: { IconLike } }),
}

/** LikeFilled icon — bookmark/save action, filled/active state. */
export const LikeFilled: Story = {
  render: () => ({ template: '<IconLikeFilled />', components: { IconLikeFilled } }),
}

/** List icon — switches to list view layout. */
export const List: Story = {
  render: () => ({ template: '<IconList />', components: { IconList } }),
}

/** Pencil icon — inline edit action. */
export const Pencil: Story = {
  render: () => ({ template: '<IconPencil />', components: { IconPencil } }),
}

/** Server icon — represents a backend/server environment. */
export const Server: Story = {
  render: () => ({ template: '<IconServer />', components: { IconServer } }),
}

/** Spark icon — triggers AI-assisted features (e.g. generate title). */
export const Spark: Story = {
  render: () => ({ template: '<IconSpark />', components: { IconSpark } }),
}
