import type { Meta, StoryObj } from '@storybook/vue3-vite'
import FullscreenRecoveryStatus from './FullscreenRecoveryStatus.vue'

const base = { serverNow: '2026-10-24T08:00:00.000Z', policyVersion: 'fullscreen-contact-v1' } as const
const meta: Meta<typeof FullscreenRecoveryStatus> = {
  title: 'Viewer/FullscreenRecoveryStatus', component: FullscreenRecoveryStatus,
  parameters: { layout: 'centered' },
}
export default meta
type Story = StoryObj<typeof FullscreenRecoveryStatus>
export const Active: Story = { args: { snapshot: { ...base, state: 'active', grant: { id: 'grant-example', activatedAt: '2026-10-20T08:00:00.000Z', expiresAt: '2026-10-27T08:00:00.000Z' } } } }
export const Expired: Story = { args: { snapshot: { ...base, state: 'expired', grant: { id: 'grant-example', activatedAt: '2026-10-16T08:00:00.000Z', expiresAt: '2026-10-23T08:00:00.000Z' } } } }
