import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { expect, userEvent, within } from 'storybook/test'
import CsatBanner from './CsatBanner.vue'
import forgeGlobal from '@/model/globals/forgeGlobal'
import { CSAT_PENDING_KEY } from '@/utils/csat'
import { getLocalStorageKey } from '@/utils/window'

type Story = StoryObj<typeof CsatBanner>

/**
 * Seed the environment so onMounted() resolves to the 'rate' phase:
 *  - mockClientDomain lets getLocalStorageKey() produce stable keys
 *  - forgeGlobal.forgeContext gives useCSATState a deterministic accountId
 *  - csatPending key makes isCsatPendingFresh() return true
 *  - csat_state is cleared so checkStateOfCSAT() returns false (not suppressed)
 */
function installMocks() {
  localStorage.setItem('mockClientDomain', 'example-tenant')
  forgeGlobal.isForge = false
  forgeGlobal.isLite = true
  forgeGlobal.forgeContext = {
    accountId: 'storybook-user',
    siteUrl: 'https://example-tenant.atlassian.net',
    extension: {
      content: { id: 'storybook-page' },
      space: { key: 'STORY' },
    },
  }
  // Arm the fresh-pending flag so the banner doesn't immediately close
  localStorage.setItem(getLocalStorageKey(CSAT_PENDING_KEY), String(Date.now()))
  // Clear any existing suppression so checkStateOfCSAT() returns false
  localStorage.removeItem(getLocalStorageKey('csat_state'))
}

const meta: Meta<typeof CsatBanner> = {
  title: 'Feedback/CsatBanner',
  component: CsatBanner,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Inline page-banner for post-save CSAT collection. ' +
          'Renders as a slim bar with face-emoji rating buttons. ' +
          'Phase transitions: hidden → rate → feedback (on rating) → thanks (on send); ' +
          'or rate → dismissed (on dismiss). ' +
          'The banner calls view.close() after thanks/dismissed — stubbed to a no-op in Storybook.',
      },
    },
  },
  decorators: [
    () => {
      installMocks()
      return { template: '<story />' }
    },
  ],
}

export default meta

/**
 * Initial state: the banner is showing with all five emoji-face rating buttons.
 * Corresponds to phase === 'rate'.
 */
export const Rate: Story = {
  name: 'Rate — all rating buttons visible',
  play: async () => {
    const canvas = within(document.body)
    // Confirm the prompt label is visible
    await expect(
      await canvas.findByText(/How's .+ working for you\?/)
    ).toBeVisible()
    // All five face buttons should be rendered
    const buttons = await canvas.findAllByRole('radio')
    await expect(buttons).toHaveLength(5)
    // Dismiss link should be present
    await expect(canvas.getByRole('button', { name: /Dismiss/ })).toBeVisible()
  },
}

/**
 * After a face is selected the inline comment input and Send button appear.
 * Corresponds to phase === 'feedback'.
 */
export const Feedback: Story = {
  name: 'Feedback — comment row visible after rating',
  play: async () => {
    const canvas = within(document.body)
    // Click the 4th face ("Good")
    const faces = await canvas.findAllByRole('radio')
    await userEvent.click(faces[3])
    // Comment input and Send should now be visible
    await expect(canvas.getByPlaceholderText(/Add a comment/)).toBeVisible()
    await expect(canvas.getByRole('button', { name: /Send/ })).toBeVisible()
  },
}

/**
 * After clicking Send the banner shows the thanks confirmation.
 * Corresponds to phase === 'thanks'.
 */
export const Thanks: Story = {
  name: 'Thanks — confirmation shown after submitting',
  play: async () => {
    const canvas = within(document.body)
    const faces = await canvas.findAllByRole('radio')
    await userEvent.click(faces[4]) // "Great"
    await userEvent.click(canvas.getByRole('button', { name: /Send/ }))
    await expect(await canvas.findByText(/Thanks!/)).toBeVisible()
    await expect(canvas.getByText(/This helps us improve/)).toBeVisible()
  },
}

/**
 * After clicking Dismiss the banner shows the snooze confirmation with an Undo link.
 * Corresponds to phase === 'dismissed'.
 */
export const Dismissed: Story = {
  name: 'Dismissed — snooze confirmation with Undo',
  play: async () => {
    const canvas = within(document.body)
    // Wait for the rate phase to be rendered, then dismiss
    await canvas.findByText(/How's .+ working for you\?/)
    await userEvent.click(canvas.getByRole('button', { name: /Dismiss/ }))
    await expect(
      await canvas.findByText(/We'll check back in a few months\./)
    ).toBeVisible()
    await expect(canvas.getByRole('button', { name: /Undo/ })).toBeVisible()
  },
}

/**
 * After dismissing, clicking Undo restores the rating phase.
 * Verifies the undo flow round-trips correctly.
 */
export const DismissedThenUndo: Story = {
  name: 'Dismissed → Undo restores rate phase',
  play: async () => {
    const canvas = within(document.body)
    await canvas.findByText(/How's .+ working for you\?/)
    await userEvent.click(canvas.getByRole('button', { name: /Dismiss/ }))
    await canvas.findByText(/We'll check back in a few months\./)
    await userEvent.click(canvas.getByRole('button', { name: /Undo/ }))
    // Rate phase should be visible again
    await expect(
      await canvas.findByText(/How's .+ working for you\?/)
    ).toBeVisible()
    await expect(await canvas.findAllByRole('radio')).toHaveLength(5)
  },
}
