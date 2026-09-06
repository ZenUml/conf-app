import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { expect, userEvent, within } from 'storybook/test'
import PaywallWarningBanner from './PaywallWarningBanner.vue'
import forgeGlobal from '@/model/globals/forgeGlobal'
import { targetingMarkerKey, macroActivityMarkerKey } from '@/utils/paywall/warningBanner'
import { spaceAdminProbeKey } from '@/utils/paywall/spaceAdminProbe'

type Story = StoryObj<typeof PaywallWarningBanner>

const DOMAIN = 'example-tenant'
const SPACE = 'ENG'
const MACRO_COUNT = 120

/**
 * Seed the localStorage markers that the banner reads synchronously in
 * <script setup>. Both keys must be written BEFORE the component is mounted;
 * the decorator runs synchronously before the story renders.
 *
 * Key derivation mirrors warningBanner.ts — using the exported helpers keeps
 * this in sync if the key format ever changes.
 */
function installMarkers() {
  // Identity keys that getClientDomain() / getSpaceKey() read
  localStorage.setItem('mockClientDomain', DOMAIN)
  localStorage.setItem('mockSpaceKey', SPACE)

  const identity = { clientDomain: DOMAIN, spaceKey: SPACE }

  // Targeting marker: space is over the limit, CSS enabled, unpaid
  localStorage.setItem(
    targetingMarkerKey(identity),
    JSON.stringify({
      severity: 'warning',
      macroCount: MACRO_COUNT,
      spacePaid: false,
      customerSuccessServiceEnabled: true,
      updatedAt: new Date().toISOString(),
    })
  )

  // Activity marker: recent edit in this browser (required by isWarningBannerVisible)
  localStorage.setItem(
    macroActivityMarkerKey(identity),
    JSON.stringify({
      lastActivityAt: new Date().toISOString(),
      activityType: 'edit',
    })
  )

  // Admin probe marker: not an admin, so the default stories render the author
  // (advocacy) variant. SpaceAdmin overrides this.
  localStorage.setItem(
    spaceAdminProbeKey(identity),
    JSON.stringify({ lastProbedAt: new Date().toISOString(), isAdmin: false, adminCount: 3 })
  )
}

/**
 * Phase 5b variant: the viewer administers this space. Note NO activity marker —
 * this is the whole point, an admin who never authors a diagram is now reached.
 */
function installSpaceAdminMarkers() {
  installMarkers()
  const identity = { clientDomain: DOMAIN, spaceKey: SPACE }
  localStorage.removeItem(macroActivityMarkerKey(identity))
  localStorage.setItem(
    spaceAdminProbeKey(identity),
    JSON.stringify({ lastProbedAt: new Date().toISOString(), isAdmin: true, adminCount: 3 })
  )
}

/**
 * Stub getView() by pre-seeding forgeGlobal.view with a no-op close.
 * getView() returns early when global.view is already set, so this prevents
 * any attempt to import @forge/bridge or call window.location.reload().
 */
function installForgeMocks() {
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
  // Pre-seed the view cache so getView() never tries to import @forge/bridge
  forgeGlobal.view = {
    close: async () => {
      console.info('[storybook] view.close() – no-op')
    },
  }
}

function installClipboardMock() {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async () => undefined },
  })
}

function installNavigationMock() {
  window.open = ((url?: string | URL) => {
    console.info('[storybook] openUrl –', String(url))
    return null
  }) as typeof window.open
}

const meta: Meta<typeof PaywallWarningBanner> = {
  title: 'Paywall/PaywallWarningBanner',
  component: PaywallWarningBanner,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Page-banner shown to macro authors when their space is over the ZenUML Lite ' +
          'diagram limit. Reads state from localStorage markers written by the macro iframe ' +
          '(targeting) and the editor save path (activity). Gate runs synchronously in ' +
          '<script setup> so the banner never flashes. ' +
          'States: shown (gate passes) → dismissed (user clicks ✕, banner hides, snooze written).',
      },
    },
  },
  decorators: [
    () => {
      installMarkers()
      installForgeMocks()
      installClipboardMock()
      installNavigationMock()
      return { template: '<story />' }
    },
  ],
}

export default meta

/**
 * Normal visible state: gate passes (targeting marker present, activity recent,
 * no dismissal within the snooze window). Shows macro count, both action
 * buttons, and the dismiss ✕.
 */
export const Shown: Story = {
  name: 'Shown — gate passes, banner visible',
  play: async () => {
    const canvas = within(document.body)
    const banner = await canvas.findByTestId('paywall-warning-banner')
    await expect(banner).toBeVisible()
    await expect(banner).toHaveTextContent(`${MACRO_COUNT} of 100`)
    await expect(await canvas.findByTestId('paywall-banner-plan-usage')).toBeVisible()
    await expect(await canvas.findByTestId('paywall-banner-dismiss')).toBeVisible()
  },
}

/**
 * Dismissed state: user clicks the ✕ button. The banner sets visible=false,
 * writes the dismissal marker (starts the 7-day snooze), and calls view.close().
 * In Storybook, view.close() is a no-op so we can assert the element is gone.
 */
export const Dismissed: Story = {
  name: 'Dismissed — banner hidden after ✕ click',
  play: async () => {
    const canvas = within(document.body)
    // Wait for the banner to appear before clicking
    await canvas.findByTestId('paywall-warning-banner')
    await userEvent.click(await canvas.findByTestId('paywall-banner-dismiss'))
    // Banner should no longer be in the DOM
    await expect(canvas.queryByTestId('paywall-warning-banner')).toBeNull()
  },
}

/**
 * Phase 5b: the viewer is a space admin of the over-limit space and has authored
 * nothing. The old gate showed this person nothing at all — they were the 93% of
 * reachable admins the banner never spoke to. They now get the direct purchase
 * CTA (Enterprise Bundle, per-space, card-paid, no site admin needed) instead of
 * the "copy a message to your admin" relay, which for an admin is circular.
 */
export const SpaceAdmin: Story = {
  name: 'Space admin — direct purchase CTA, no authoring required',
  // Since 16459050 the audience is resolved by the host route (Phase 5b flag)
  // and passed down as a prop — the component never re-derives it from the
  // probe marker, so the story must pass the prop explicitly.
  args: { isSpaceAdmin: true },
  decorators: [
    () => {
      installSpaceAdminMarkers()
      return { template: '<story />' }
    },
  ],
  play: async () => {
    const canvas = within(document.body)
    const banner = await canvas.findByTestId('paywall-warning-banner')
    await expect(banner).toBeVisible()
    await expect(banner).toHaveTextContent('You administer this space')
    // The purchase CTA replaces the advocacy relay for this audience.
    await expect(await canvas.findByTestId('paywall-banner-unlock-space')).toHaveTextContent('$299')
    await expect(await canvas.findByTestId('paywall-banner-plan-usage')).toBeVisible()
  },
}
