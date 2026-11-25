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
  args: { context: { spaceKey: 'EXAMPLE' }, snapshot: { ...base, state: 'not_requested' } },
}
export default meta
type Story = StoryObj<typeof FullscreenRecoveryGate>

export const ChooseUse: Story = {}
export const Contact: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByLabelText('Present this diagram to others'))
    await userEvent.click(canvas.getByRole('button', { name: 'Request temporary access' }))
    await expect(canvas.getByRole('heading', { name: 'Request temporary access' })).toBeVisible()
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
    await userEvent.click(canvas.getByRole('button', { name: 'Request temporary access' }))
    await userEvent.type(canvas.getByLabelText('Reply email'), 'reader@example.com')
    await userEvent.click(canvas.getByLabelText(/I agree that support may use this email/))
    await userEvent.click(canvas.getByRole('button', { name: 'Submit request' }))
    await expect(canvas.getByRole('alert')).toBeVisible()
  },
}

// Edit request gate: the same panel with editing wording (`feature: 'edit'`). Five views.
const editBase = { serverNow: '2026-12-08T09:00:00.000Z', policyVersion: 'edit-contact-v1', limit: 100, supportEmail: 'support@example.com' } as const
const editRequest = {
  id: 'EDIT-EXAMPLE-001', scenarios: ['fix_or_update', 'prepare_review'] as ('fix_or_update' | 'prepare_review')[],
  note: 'Updating the checkout flow before the release.', email: 'author@example.com', createdAt: '2026-12-08T08:00:00.000Z',
}
const editPending: RecoverySnapshot = { ...editBase, state: 'pending_activation', request: { ...editRequest, mailState: 'queued' }, grant: { id: 'grant-example', activatedAt: null, expiresAt: null } }
const editActive: RecoverySnapshot = { ...editBase, state: 'active', request: { ...editRequest, mailState: 'delivered' }, grant: { id: 'grant-example', activatedAt: '2026-12-08T09:00:00.000Z', expiresAt: '2026-12-15T09:00:00.000Z' } }
const editExpired: RecoverySnapshot = { ...editBase, state: 'expired', request: { ...editRequest, mailState: 'accepted' }, grant: { id: 'grant-example', activatedAt: '2026-12-01T09:00:00.000Z', expiresAt: '2026-12-08T09:00:00.000Z' } }

/** E1: no edit request yet. */
export const EditChooseUse: Story = { args: { feature: 'edit', snapshot: { ...editBase, state: 'not_requested' } } }
export const EditContact: Story = {
  args: { feature: 'edit', snapshot: { ...editBase, state: 'not_requested' } },
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByLabelText('Fix or update a diagram'))
    await userEvent.click(canvas.getByRole('button', { name: 'Request temporary access' }))
    await expect(canvas.getByRole('heading', { name: 'Request temporary access' })).toBeVisible()
  },
}
/** E2: request saved; the 7 days start at the first save. */
export const EditReady: Story = { args: { feature: 'edit', snapshot: editPending } }
/** E4: the 7 days are over. */
export const EditAccessEnded: Story = { args: { feature: 'edit', snapshot: editExpired } }
export const EditContinueRequest: Story = { args: { feature: 'edit', snapshot: editActive, initialView: 'request' } }
