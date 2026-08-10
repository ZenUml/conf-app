import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import UpgradePrompt from './UpgradePrompt.vue'
import { trackUpgradeEvent, UpgradeEventName } from '@/utils/upgradeTracking'
import { openUrl } from '@/model/globals/forgeGlobal'

/**
 * Last-continue commitment beat (paywall-rhythm W1). When exactly one continue
 * attempt remains, the modal must stop offering a plain dismiss and ask a
 * commitment question whose every answer is a degree of yes: unlock now, route
 * the request to an admin, or knowingly spend the final attempt. These tests
 * pin (a) the prompt renders only at remaining=1, (b) each answer fires
 * `paywall_commitment_answered` with its `commitment_answer`, and (c) the
 * continue-last path still performs the normal continue (the metered escape
 * hatch is narrowed, never removed).
 *
 * Mounted with `attachTo: document.body` and queried via `document` — the
 * modal renders through <Teleport to="body">, and the teleport STUB does not
 * propagate post-mount reactive updates (the `commitment-status` line renders
 * only after an async answer), so the stub approach used by the render-only
 * purchase spec cannot work here.
 */

vi.mock('@/utils/upgradeTracking', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/upgradeTracking')>()
  return { ...actual, trackUpgradeEvent: vi.fn() }
})

vi.mock('@/model/globals/forgeGlobal', () => ({
  default: { forgeContext: null },
  openUrl: vi.fn(),
  getView: vi.fn(() => Promise.resolve({ close: vi.fn() })),
}))

vi.mock('@/composables/useCustomerSuccessService', () => ({
  useCustomerSuccessService: () => ({ spaceKey: { value: 'ENG' } }),
  getUpgradeContext: () => ({ macro_count: 147, macro_limit: 100 }),
}))

vi.mock('./PaywallHero.vue', () => ({ default: { template: '<div />' } }))

const BASE_PROPS = {
  visible: true,
  macrosCreated: 147,
  macrosLimit: 100,
  upgradeUrl: 'https://marketplace.example.com/apps/1218380?domain=acme',
  enterpriseBundleUrl: 'https://buy.stripe.example.com/bundle',
}

let wrapper: VueWrapper | undefined

function mountModal(extra: Record<string, unknown> = {}) {
  wrapper = mount(UpgradePrompt, {
    props: { ...BASE_PROPS, ...extra },
    attachTo: document.body,
  })
  return wrapper
}

function q(testid: string): HTMLElement | null {
  return document.querySelector(`[data-testid="${testid}"]`)
}

function commitmentEvents() {
  return vi
    .mocked(trackUpgradeEvent)
    .mock.calls.filter(([name]) => name === UpgradeEventName.PAYWALL_COMMITMENT_ANSWERED)
}

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('UpgradePrompt — last-continue commitment beat', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
  })

  it('renders the commitment prompt only when exactly one attempt remains', () => {
    mountModal({ remainingContinueAttempts: 1 })
    expect(q('commitment-prompt')).toBeTruthy()
    wrapper!.unmount()

    mountModal({ remainingContinueAttempts: 2 })
    expect(q('commitment-prompt')).toBeNull()
    wrapper!.unmount()

    mountModal({ remainingContinueAttempts: 0 })
    expect(q('commitment-prompt')).toBeNull()
    wrapper!.unmount()

    mountModal({})
    expect(q('commitment-prompt')).toBeNull()
  })

  it('unlock answer tracks the commitment and opens the bundle checkout', async () => {
    mountModal({ remainingContinueAttempts: 1 })

    ;(q('commitment-unlock-btn') as HTMLButtonElement).click()
    await flush()

    const events = commitmentEvents()
    expect(events).toHaveLength(1)
    expect(events[0][1]).toMatchObject({ commitment_answer: 'unlock', mirror_level: 'space' })
    expect(vi.mocked(openUrl)).toHaveBeenCalledWith(BASE_PROPS.enterpriseBundleUrl)
  })

  it('ask-admin answer tracks the commitment and copies the advocacy request', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
    mountModal({ remainingContinueAttempts: 1 })

    ;(q('commitment-ask-admin-btn') as HTMLButtonElement).click()
    await flush()
    await wrapper!.vm.$nextTick()

    const events = commitmentEvents()
    expect(events).toHaveLength(1)
    expect(events[0][1]).toMatchObject({ commitment_answer: 'ask_admin' })
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(q('commitment-status')?.textContent).toContain('Request copied')
  })

  it('continue-last answer tracks the commitment and still performs the continue', async () => {
    mountModal({ remainingContinueAttempts: 1 })

    ;(q('continue-editing-btn') as HTMLButtonElement).click()
    await flush()

    const events = commitmentEvents()
    expect(events).toHaveLength(1)
    expect(events[0][1]).toMatchObject({ commitment_answer: 'continue_last' })
    expect(wrapper!.emitted('continueEditing')).toHaveLength(1)
    const exhausted = vi
      .mocked(trackUpgradeEvent)
      .mock.calls.filter(([name]) => name === UpgradeEventName.PAYWALL_ATTEMPTS_EXHAUSTED)
    expect(exhausted).toHaveLength(1)
  })
})
