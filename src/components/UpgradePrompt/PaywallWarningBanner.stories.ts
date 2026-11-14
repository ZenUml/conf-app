import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { expect, within } from 'storybook/test'
import PaywallWarningBanner from './PaywallWarningBanner.vue'
import forgeGlobal from '@/model/globals/forgeGlobal'
import { targetingMarkerKey, macroActivityMarkerKey, impressionMarkerKey } from '@/utils/paywall/warningBanner'
import { spaceAdminProbeKey } from '@/utils/paywall/spaceAdminProbe'

type Story = StoryObj<typeof PaywallWarningBanner>

const DOMAIN = 'example-tenant'
const SPACE = 'ENG'
const CLEAN_SPACE = '~clean'
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

  // Each story starts with a fresh impression counter.
  localStorage.removeItem(impressionMarkerKey(identity))

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

/** The context a page-banner iframe received after an SPA navigation. */
function installStaleSpaceContext(contextSpace: string, pageSpace: string) {
  forgeGlobal.forgeContext = {
    accountId: 'storybook-user',
    siteUrl: `https://${DOMAIN}.atlassian.net`,
    extension: {
      type: 'confluence:pageBanner',
      content: { id: '200' },
      space: { key: contextSpace, id: '1' },
      location: `https://${DOMAIN}.atlassian.net/wiki/spaces/${pageSpace}/pages/200/Title`,
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
  title: 'Page banner/PaywallWarningBanner',
  component: PaywallWarningBanner,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Non-blocking page banner (confluence:pageBanner) on pages of an over-limit ZenUML ' +
          'Lite space — since the editing block was retired this is the only in-product paywall ' +
          'surface. Two audiences: recent macro authors and eligible space admins get different ' +
          'copy, and both get one action, View plan and usage. The banner carries no purchase ' +
          'control (Forge pageBanner guideline). The gate reads localStorage markers ' +
          'synchronously in <script setup> — targeting written by the macro iframe, activity by ' +
          'the editor save path — so the banner never flashes. It stays visible on ' +
          'each qualifying page load and records impressions for analytics.',
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
 * current policy, unpaid space, over 100 macros, recent author). Shows the
 * macro count and the View plan and usage button.
 */
export const Shown: Story = {
  name: 'Shown — gate passes, banner visible',
  play: async () => {
    const canvas = within(document.body)
    const banner = await canvas.findByTestId('paywall-warning-banner')
    await expect(banner).toBeVisible()
    await expect(banner).toHaveTextContent(`${MACRO_COUNT} of 100`)
    await expect(await canvas.findByTestId('paywall-banner-plan-usage')).toBeVisible()
    await expect(canvas.queryByTestId('paywall-banner-dismiss')).toBeNull()
  },
}

/**
 * Quick find from an over-limit space: the banner iframe's Forge context still
 * names that space while the page URL names a clean one. The over-limit marker
 * belongs to the previous space, so nothing shows.
 */
export const QuickFindToCleanSpace: Story = {
  name: 'Quick find to a clean space — stale context, no banner',
  decorators: [
    () => {
      installStaleSpaceContext(SPACE, CLEAN_SPACE)
      return { template: '<story />' }
    },
  ],
  play: async () => {
    const canvas = within(document.body)
    await expect(canvas.queryByTestId('paywall-warning-banner')).toBeNull()
  },
}

/**
 * Quick find from a clean space: the context names the clean space while the
 * page URL names the over-limit one, whose warning must show.
 */
export const QuickFindToOverLimitSpace: Story = {
  name: 'Quick find to an over-limit space — stale context, banner shows',
  decorators: [
    () => {
      installStaleSpaceContext(CLEAN_SPACE, SPACE)
      return { template: '<story />' }
    },
  ],
  play: async () => {
    const canvas = within(document.body)
    const banner = await canvas.findByTestId('paywall-warning-banner')
    await expect(banner).toBeVisible()
    await expect(banner).toHaveTextContent(`${MACRO_COUNT} of 100`)
  },
}

/**
 * Existing browser data can contain an old dismissal and a high show count.
 * Neither affects eligibility on the next page load.
 */
export const RepeatedImpression: Story = {
  name: 'Repeated impression — legacy dismissal ignored',
  decorators: [
    () => {
      const identity = { clientDomain: DOMAIN, spaceKey: SPACE }
      localStorage.setItem(impressionMarkerKey(identity), JSON.stringify({
        dismissedAt: new Date().toISOString(),
        lastShownAt: new Date().toISOString(),
        showCount: 50,
      }))
      return { template: '<story />' }
    },
  ],
  play: async () => {
    const canvas = within(document.body)
    await expect(await canvas.findByTestId('paywall-warning-banner')).toBeVisible()
    await expect(canvas.queryByTestId('paywall-banner-dismiss')).toBeNull()
  },
}

/**
 * Phase 5b: the viewer is a space admin of the over-limit space and has authored
 * nothing. The old gate showed this person nothing at all — they were the 93% of
 * reachable admins the banner never spoke to. They now get admin-addressed copy
 * and View plan and usage; the author variant instead asks a site admin to
 * upgrade. Neither variant has a purchase or checkout control.
 */
export const SpaceAdmin: Story = {
  name: 'Space admin — no checkout control, no authoring required',
  // The audience is resolved by the host route
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
    // Page banner guideline: no upsell. Only View plan and usage.
    await expect(canvas.queryByTestId('paywall-banner-unlock-space')).toBeNull()
    await expect(await canvas.findByTestId('paywall-banner-plan-usage')).toBeVisible()
  },
}
