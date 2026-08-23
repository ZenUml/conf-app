import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { expect, userEvent, within } from 'storybook/test'
import PaywallExtensionJourney from './PaywallExtensionJourney.story.vue'
import forgeGlobal from '@/model/globals/forgeGlobal'
import { useCustomerSuccessService } from '@/composables/useCustomerSuccessService'
import { macroActivityMarkerKey, targetingMarkerKey } from '@/utils/paywall/warningBanner'
import { spaceAdminProbeKey } from '@/utils/paywall/spaceAdminProbe'

type Story = StoryObj<typeof PaywallExtensionJourney>

const DOMAIN = 'example-tenant'
const SPACE = 'STORY'

function installInertJourneyFixtures() {
  localStorage.setItem('mockClientDomain', DOMAIN)
  localStorage.setItem('mockSpaceKey', SPACE)
  localStorage.setItem('mockMacroCount', '105')
  localStorage.setItem('mockCSSEnabled', 'true')
  localStorage.setItem('mockSpacePaid', 'false')

  const identity = { clientDomain: DOMAIN, spaceKey: SPACE }
  localStorage.setItem(targetingMarkerKey(identity), JSON.stringify({
    severity: 'warning',
    macroCount: 105,
    spacePaid: false,
    customerSuccessServiceEnabled: true,
    updatedAt: new Date().toISOString(),
  }))
  localStorage.setItem(macroActivityMarkerKey(identity), JSON.stringify({
    lastActivityAt: new Date().toISOString(),
    activityType: 'edit',
  }))
  localStorage.setItem(spaceAdminProbeKey(identity), JSON.stringify({
    lastProbedAt: new Date().toISOString(),
    isAdmin: false,
    adminCount: 2,
  }))

  forgeGlobal.isForge = false
  forgeGlobal.isLite = true
  forgeGlobal.forgeContext = {
    accountId: 'storybook-user',
    siteUrl: `https://${DOMAIN}.atlassian.net`,
    extension: {
      content: { id: 'storybook-page' },
      space: { key: SPACE },
    },
  }
  forgeGlobal.view = { close: async () => undefined }

  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async () => undefined },
  })
  window.open = (() => null) as typeof window.open

  ;(useCustomerSuccessService as unknown as { __resetForTests?: () => void }).__resetForTests?.()
  void useCustomerSuccessService().initialize()
}

const meta: Meta<typeof PaywallExtensionJourney> = {
  title: 'Paywall/Full extension journey',
  component: PaywallExtensionJourney,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    viewport: { defaultViewport: 'responsive' },
    docs: {
      description: {
        component:
          'Interactive review surface for the complete seven-day extension journey. ' +
          'Implemented nodes reuse production components; Concept nodes are inert local fixtures.',
      },
    },
  },
  decorators: [
    () => {
      installInertJourneyFixtures()
      return { template: '<story />' }
    },
  ],
}

export default meta

export const CompleteProcess: Story = {
  name: 'Complete process — implemented vs concept',
  play: async () => {
    const body = within(document.body)

    await expect(await body.findByTestId('paywall-extension-journey')).toBeVisible()
    await expect(await body.findByTestId('journey-inventory')).toHaveTextContent('7 Implemented')
    await expect(await body.findByTestId('journey-inventory')).toHaveTextContent('9 Concept')

    for (const group of ['Paywall', 'Extension intake', 'Granted', 'Admin outreach', 'Expiry / repeat', 'Upgrade']) {
      await expect(body.getByRole('heading', { name: group })).toBeVisible()
    }

    await expect(await body.findByTestId('paywall-warning-banner')).toBeVisible()

    const attempts: Array<[string, string]> = [
      ['paywall-3', 'Continue editing without upgrading (3)'],
      ['paywall-2', 'Continue editing (2 left)'],
      ['paywall-1', 'Continue editing (last time)'],
    ]
    for (const [stage, copy] of attempts) {
      await userEvent.click(body.getByTestId(`journey-stage-${stage}`))
      await expect(await body.findByTestId('continue-editing-btn')).toHaveTextContent(copy)
    }
    await expect(await body.findByTestId('commitment-prompt')).toBeVisible()

    await userEvent.click(body.getByTestId('journey-stage-paywall-0'))
    await expect(await body.findByTestId('continue-attempts-exhausted')).toBeVisible()
    await expect(body.queryByTestId('continue-editing-btn')).toBeNull()

    await userEvent.click(body.getByTestId('journey-stage-intake'))
    await expect(await body.findByTestId('journey-stage-status')).toHaveTextContent('Concept')
    await expect(await body.findByTestId('extension-disclosure')).toHaveTextContent('registered technical or site contact')
    await expect(await body.findByTestId('extension-question-count')).toHaveTextContent('3 questions')
    await expect(body.getAllByTestId('extension-question')).toHaveLength(3)
    await userEvent.selectOptions(body.getByLabelText('Requested unblock scope'), 'site')

    await userEvent.click(body.getByTestId('journey-next'))
    await expect(await body.findByTestId('journey-stage-title')).toHaveTextContent('7-day access')
    await expect(await body.findByTestId('grant-expiry')).toHaveTextContent('31 Aug 2026, 09:00 AEST')
    await userEvent.click(body.getByTestId('return-to-editor'))
    await expect(await body.findByTestId('editor-returned')).toHaveTextContent('Editor reopened')

    await userEvent.click(body.getByTestId('journey-back'))
    await expect(body.getByLabelText('Requested unblock scope')).toHaveValue('site')

    for (const stage of ['admin-auto', 'admin-manual', 'admin-email', 'reminder', 'expired', 'repeat']) {
      await userEvent.click(body.getByTestId(`journey-stage-${stage}`))
      await expect(await body.findByTestId('journey-stage-status')).toHaveTextContent('Concept')
    }
    await expect(await body.findByTestId('journey-stage-title')).toHaveTextContent('Repeat request')
    await expect(await body.findByTestId('journey-stage-canvas')).toHaveTextContent('No new access is promised')

    await userEvent.click(body.getByTestId('journey-stage-admin-email'))
    await expect(await body.findByTestId('admin-email-preview')).toHaveTextContent('USD 299/year/Space')
    await expect(await body.findByTestId('admin-email-preview')).toHaveTextContent('No recipient address is loaded')

    await userEvent.click(body.getByTestId('journey-stage-upgrade-space'))
    await expect(await body.findByTestId('unlock-space-btn')).toHaveTextContent('$299/yr/space')
    await expect(await body.findByTestId('journey-stage-status')).toHaveTextContent('Implemented')

    await userEvent.click(body.getByTestId('journey-stage-upgrade-site'))
    await expect(await body.findByTestId('marketplace-cta')).toBeVisible()

    await userEvent.click(body.getByTestId('journey-stage-activation'))
    await expect(await body.findByTestId('journey-stage-canvas')).toHaveTextContent('License confirmed')
    await expect(await body.findByTestId('journey-next')).toBeDisabled()

    await userEvent.click(body.getByTestId('journey-reset'))
    await expect(await body.findByTestId('journey-stage-title')).toHaveTextContent('Early warning')
    await expect(await body.findByTestId('journey-progress')).toHaveTextContent('1 / 16')
  },
}
