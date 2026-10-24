import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { expect, userEvent, within } from 'storybook/test'
import FullscreenRecoveryGate from './FullscreenRecoveryGate.vue'
import type { RecoverySnapshot } from '../../../shared/fullscreenRecovery'

const base = {
  serverNow: '2026-10-24T08:00:00.000Z',
  policyVersion: 'fullscreen-contact-v1',
  supportEmail: 'support@example.com',
} as const
const request = {
  id: 'FS-EXAMPLE-001', scenarios: ['inspect_details', 'discuss'] as const,
  note: 'Need to review a few interactions.', email: 'reader@example.com',
  createdAt: '2026-10-24T07:00:00.000Z',
}
const pending: RecoverySnapshot = { ...base, state: 'pending_activation', request: { ...request, scenarios: [...request.scenarios], mailState: 'queued' }, grant: { id: 'grant-example', activatedAt: null, expiresAt: null } }
const active: RecoverySnapshot = { ...base, state: 'active', request: { ...request, scenarios: [...request.scenarios], mailState: 'delivered' }, grant: { id: 'grant-example', activatedAt: '2026-10-20T08:00:00.000Z', expiresAt: '2026-10-27T08:00:00.000Z' } }
const expired: RecoverySnapshot = { ...base, state: 'expired', request: { ...request, scenarios: [...request.scenarios], mailState: 'accepted' }, grant: { id: 'grant-example', activatedAt: '2026-10-16T08:00:00.000Z', expiresAt: '2026-10-23T08:00:00.000Z' } }

const meta: Meta<typeof FullscreenRecoveryGate> = {
  title: 'Viewer/FullscreenRecoveryGate', component: FullscreenRecoveryGate,
  parameters: { layout: 'centered' },
  args: { snapshot: { ...base, state: 'not_requested' } },
}
export default meta
type Story = StoryObj<typeof FullscreenRecoveryGate>

export const ChooseUse: Story = {}
export const Contact: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByLabelText('Present this diagram to others'))
    await userEvent.click(canvas.getByRole('button', { name: 'Contact support' }))
    await expect(canvas.getByRole('heading', { name: 'Contact support' })).toBeVisible()
  },
}
export const PendingActivation: Story = { args: { snapshot: pending } }
export const Expired: Story = { args: { snapshot: expired } }
export const RequestMailPending: Story = { args: { snapshot: pending, initialView: 'request' } }
export const RequestMailSent: Story = { args: { snapshot: active, initialView: 'request' } }
export const RequestDeliveryIssue: Story = { args: { snapshot: { ...expired, request: { ...expired.request!, mailState: 'delivery_unknown' } }, initialView: 'request' } }
export const RequestError: Story = {
  args: { request: async () => { throw new Error('example service failure') } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByLabelText('Present this diagram to others'))
    await userEvent.click(canvas.getByRole('button', { name: 'Contact support' }))
    await userEvent.type(canvas.getByLabelText('Reply email'), 'reader@example.com')
    await userEvent.click(canvas.getByLabelText(/I agree that support may use this email/))
    await userEvent.click(canvas.getByRole('button', { name: 'Submit request' }))
    await expect(canvas.getByRole('alert')).toBeVisible()
  },
}
