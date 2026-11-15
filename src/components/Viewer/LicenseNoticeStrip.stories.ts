// @ts-expect-error -- resolved by Storybook's Vite pipeline
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import LicenseNoticeStrip from './LicenseNoticeStrip.vue'

/**
 * Lite per-site enforcement variant (basis `site_policy_limit_reached`): the
 * server said the watermark applies, so the strip names the Lite limit and
 * points to Plan and usage. No Marketplace link, price or checkout.
 * Counts are invented.
 */
const meta: Meta<typeof LicenseNoticeStrip> = {
  title: 'Viewer/LicenseNoticeStrip',
  component: LicenseNoticeStrip,
  parameters: { layout: 'padded' },
  args: { surface: 'viewer', macroType: 'mermaid' },
}
export default meta

type Story = StoryObj<typeof LicenseNoticeStrip>

const liteArgs = { basis: 'site_policy_limit_reached', limit: 100, stage: 'watermark' } as const

export const FullNoActiveLicense: Story = {}
export const LiteCount2282: Story = { args: { ...liteArgs, count: 2282 } }
export const LiteCount100: Story = { args: { ...liteArgs, count: 100 } }
