import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { expect, userEvent, within } from 'storybook/test'
import FullscreenRecoveryGate from './FullscreenRecoveryGate.vue'
import type { RecoverySnapshot } from '../../../shared/fullscreenRecovery'

// The edit request gate: the same panel as Fullscreen with editing wording. Five views.
const base = {
  serverNow: '2026-12-08T09:00:00.000Z', policyVersion: 'edit-contact-v1', limit: 100, supportEmail: 'support@example.com',
} as const
const request = {
  id: 'EDIT-EXAMPLE-001', scenarios: ['fix_or_update' as const, 'prepare_review' as const],
  note: 'Updating the checkout flow before the release.', email: 'author@example.com', createdAt: '2026-12-08T08:00:00.000Z',
}
const pending: RecoverySnapshot = { ...base, state: 'pending_activation', request: { ...request, mailState: 'queued' }, grant: { id: 'grant-example', activatedAt: null, expiresAt: null } }
const active: RecoverySnapshot = { ...base, state: 'active', request: { ...request, mailState: 'delivered' }, grant: { id: 'grant-example', activatedAt: '2026-12-08T09:00:00.000Z', expiresAt: '2026-12-15T09:00:00.000Z' } }
const expired: RecoverySnapshot = { ...base, state: 'expired', request: { ...request, mailState: 'accepted' }, grant: { id: 'grant-example', activatedAt: '2026-12-01T09:00:00.000Z', expiresAt: '2026-12-08T09:00:00.000Z' } }

const meta: Meta<typeof FullscreenRecoveryGate> = {
  title: 'Editor/EditRequestGate', component: FullscreenRecoveryGate,
  parameters: { layout: 'centered' },
  args: { feature: 'edit', context: { spaceKey: 'EXAMPLE' }, snapshot: { ...base, state: 'not_requested' } },
}
export default meta
type Story = StoryObj<typeof FullscreenRecoveryGate>

/** E1: no request yet. */
export const ChooseUse: Story = {}
export const Contact: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByLabelText('Fix or update this diagram'))
    await userEvent.click(canvas.getByRole('button', { name: 'Contact support' }))
    await expect(canvas.getByRole('heading', { name: 'Contact support' })).toBeVisible()
  },
}
/** E2: request saved, the 7 days start at the first save. */
export const EditingReady: Story = { args: { snapshot: pending } }
/** E4: the 7 days are over. */
export const AccessEnded: Story = { args: { snapshot: expired } }
/** The existing request, seen again. */
export const ContinueRequest: Story = { args: { snapshot: active, initialView: 'request' } }
