import type { Meta, StoryObj } from '@storybook/vue3-vite'
import SecondDiagramPrompt from './SecondDiagramPrompt.vue'

/**
 * Onboarding funnel — "second diagram" viewer prompt (`data-testid="second-diagram-prompt"`).
 *
 * Production visibility is gated by the VITE_SECOND_DIAGRAM_PROMPT_ENABLED
 * build-time constant (vite.config.mjs, default OFF) — these stories use the
 * story-only `forceEnabled` prop so the affordance can be reviewed without a
 * rebuild. No production call site (GenericViewer.vue) ever sets that prop.
 */
const CREATOR = 'acct-creator'
const OTHER_AUTHOR = 'acct-other'

const meta: Meta<typeof SecondDiagramPrompt> = {
  title: 'Viewer/SecondDiagramPrompt',
  component: SecondDiagramPrompt,
  parameters: { layout: 'centered' },
}
export default meta

type Story = StoryObj<typeof SecondDiagramPrompt>

/** Constant on, current viewer is the creator, viewer ready — the visible state. */
export const Visible: Story = {
  args: {
    forceEnabled: true,
    attribution: { customContentId: '93093905', createdByAccountId: CREATOR },
    macroType: 'sequence',
    ready: true,
    currentAccountId: CREATOR,
  },
  decorators: [() => ({ template: '<div style="padding:24px; width:360px; border:1px solid #eee"><story/></div>' })],
}

/** Constant on but the current viewer did not author this diagram — stays hidden. */
export const HiddenNotCreator: Story = {
  args: {
    forceEnabled: true,
    attribution: { customContentId: '93093905', createdByAccountId: CREATOR },
    macroType: 'sequence',
    ready: true,
    currentAccountId: OTHER_AUTHOR,
  },
}

/** Production default: the build-time constant is off, so nothing renders regardless of the other conditions. */
export const HiddenConstantOff: Story = {
  args: {
    attribution: { customContentId: '93093905', createdByAccountId: CREATOR },
    macroType: 'sequence',
    ready: true,
    currentAccountId: CREATOR,
  },
}
