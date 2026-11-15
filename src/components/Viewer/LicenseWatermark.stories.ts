// @ts-expect-error -- resolved by Storybook's Vite pipeline
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import LicenseWatermark from './LicenseWatermark.vue'

/**
 * The diagonal watermark over a placeholder diagram area. Full uses the
 * default text; the Lite per-site enforcement variant passes its own headline
 * and detail (count formatted by the viewer). Counts are invented.
 */
const meta: Meta<typeof LicenseWatermark> = {
  title: 'Viewer/LicenseWatermark',
  component: LicenseWatermark,
  parameters: { layout: 'padded' },
  render: (args) => ({
    components: { LicenseWatermark },
    setup: () => ({ args }),
    template: `
      <div style="position: relative; width: 720px; height: 225px; background: #F7F8F9; border: 1px solid #DCDFE4;">
        <LicenseWatermark v-bind="args" />
      </div>`,
  }),
}
export default meta

type Story = StoryObj<typeof LicenseWatermark>

export const Full: Story = {}
export const LiteCount2282: Story = {
  args: { headline: 'UPGRADE REQUIRED', detail: '2,282 of 100 Lite diagrams in this space · Ask your Confluence admin to upgrade' },
}
export const LiteCount150: Story = {
  args: { headline: 'UPGRADE REQUIRED', detail: '150 of 100 Lite diagrams in this space · Ask your Confluence admin to upgrade' },
}
// Longest second line expected in practice (five-digit count): the fit check.
export const LiteCount48203: Story = {
  args: { headline: 'UPGRADE REQUIRED', detail: '48,203 of 100 Lite diagrams in this space · Ask your Confluence admin to upgrade' },
}
