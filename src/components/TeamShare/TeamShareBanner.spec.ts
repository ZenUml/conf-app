import { mount, enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import TeamShareBanner from './TeamShareBanner.vue'
import forgeGlobal from '@/model/globals/forgeGlobal'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'
import {
  armTeamShareIfEligible,
  isTeamShareShown,
  readTeamSharePending,
} from '@/utils/teamShare'
import { isCsatPendingFresh, markCsatPending } from '@/utils/csat'

const viewClose = vi.hoisted(() => vi.fn())
vi.mock('@forge/bridge', () => ({ view: { close: viewClose } }))
vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent: vi.fn() }))

const writeClipboardWithMethod = vi.hoisted(() => vi.fn())
vi.mock('@/composables/agentLink/clipboard', () => ({ writeClipboardWithMethod }))

const api = vi.hoisted(() => ({
  getPageTitleAndUrl: vi.fn(),
  getDiagramBodyInfo: vi.fn(),
}))
vi.mock('@/model/globals', () => ({ default: { apWrapper: api } }))

const original = (forgeGlobal as any).forgeContext
const PAGE_URL = 'https://example-tenant.atlassian.net/wiki/spaces/ENG/pages/555/Checkout'

async function armAndMount(diagramTitle = 'Checkout flow', count = 3) {
  await armTeamShareIfEligible({
    contentId: '9',
    diagramTitle,
    apWrapper: { countSiteDiagramsUpTo: async () => count, _getCurrentPageId: async () => '555' } as any,
  })
  const wrapper = mount(TeamShareBanner)
  await flushPromises()
  return wrapper
}

const events = (name: string) => vi.mocked(trackAnalyticsEvent).mock.calls.filter(([n]) => n === name)
const button = (w: ReturnType<typeof mount>, name: string) =>
  w.findAll('button').find((b) => b.text().includes(name))!

enableAutoUnmount(afterEach)

describe('TeamShareBanner', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('mockClientDomain', 'example-tenant')
    vi.stubEnv('PRODUCT_TYPE', 'lite')
    ;(forgeGlobal as any).forgeContext = {
      accountId: 'acct-1',
      extension: { content: { id: '555' }, location: PAGE_URL },
    }
    viewClose.mockReset()
    vi.mocked(trackAnalyticsEvent).mockReset()
    writeClipboardWithMethod.mockReset()
    writeClipboardWithMethod.mockResolvedValue('clipboard_api')
    api.getPageTitleAndUrl.mockReset()
    api.getPageTitleAndUrl.mockResolvedValue({ title: 'Checkout service', url: PAGE_URL })
    api.getDiagramBodyInfo.mockReset()
    api.getDiagramBodyInfo.mockResolvedValue({ title: 'Checkout flow', diagramType: 'sequence' })
  })

  afterEach(() => {
    ;(forgeGlobal as any).forgeContext = original
    vi.useRealTimers()
    vi.unstubAllEnvs()
    localStorage.clear()
  })

  it('shows the headline with the diagram title, marks shown, clears both triggers, fires shown', async () => {
    markCsatPending()
    const w = await armAndMount()
    expect(w.text()).toContain('Nice — "Checkout flow" is on this page. Share it with your team?')
    expect(isTeamShareShown()).toBe(true)
    expect(readTeamSharePending()).toBeNull()
    expect(isCsatPendingFresh()).toBe(false)
    expect(events('team_share_prompt_shown')).toHaveLength(1)
    expect(viewClose).not.toHaveBeenCalled()
  })

  it('falls back to the generic headline for a placeholder title', async () => {
    api.getDiagramBodyInfo.mockResolvedValue({ title: 'Untitled 2026-11-28T00:00:00.000Z', diagramType: 'sequence' })
    const w = await armAndMount('Untitled 2026-11-28T00:00:00.000Z')
    expect(w.text()).toContain('Nice — your diagram is on this page. Share it with your team?')
  })

  it('uses the marker title when the body has none', async () => {
    api.getDiagramBodyInfo.mockResolvedValue({ title: '', diagramType: 'sequence' })
    const w = await armAndMount('From marker')
    expect(w.text()).toContain('"From marker"')
  })

  it('copies the 3-line message with the diagram title', async () => {
    const w = await armAndMount()
    await button(w, 'Copy message').trigger('click')
    await flushPromises()
    expect(writeClipboardWithMethod).toHaveBeenCalledWith(
      [
        'I made a diagram on "Checkout service": Checkout flow.',
        `Take a look: ${PAGE_URL}`,
        'Want one on your page? Edit it, type /zenuml, and pick a diagram type.',
      ].join('\n'),
    )
    expect(button(w, 'Copied ✓').classes()).toContain('pb-primary-done')
    expect(w.text()).toContain('Paste it in Slack, Teams or email.')
  })

  it('omits the diagram title from line one when there is none', async () => {
    api.getDiagramBodyInfo.mockResolvedValue({ title: '', diagramType: 'sequence' })
    const w = await armAndMount('')
    await button(w, 'Copy message').trigger('click')
    await flushPromises()
    expect(writeClipboardWithMethod.mock.calls[0][0].split('\n')[0]).toBe('I made a diagram on "Checkout service".')
  })

  it('copies just the link and says so', async () => {
    const w = await armAndMount()
    await button(w, 'Copy link').trigger('click')
    await flushPromises()
    expect(writeClipboardWithMethod).toHaveBeenCalledWith(PAGE_URL)
    expect(w.text()).toContain('Link copied ✓')
    expect(w.text()).not.toContain('Paste it in Slack')
  })

  it('closes 5 seconds after a copy, not before', async () => {
    const w = await armAndMount()
    vi.useFakeTimers()
    await button(w, 'Copy link').trigger('click')
    await vi.advanceTimersByTimeAsync(4999)
    expect(viewClose).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2)
    expect(viewClose).toHaveBeenCalledTimes(1)
  })

  it('Not now closes at once and fires dismissed', async () => {
    const w = await armAndMount()
    await button(w, 'Not now').trigger('click')
    expect(viewClose).toHaveBeenCalledTimes(1)
    expect(events('team_share_dismissed')[0][1]).toMatchObject({ dismiss_kind: 'not_now' })
  })

  it('shows the text for a manual copy when both clipboard paths fail', async () => {
    writeClipboardWithMethod.mockResolvedValue(null)
    const w = await armAndMount()
    await button(w, 'Copy message').trigger('click')
    await flushPromises()
    const input = w.find('input[readonly]')
    expect((input.element as HTMLInputElement).value).toContain('Take a look: ' + PAGE_URL)
    expect(w.text()).toContain('Press Ctrl/Cmd+C to copy')
    expect(events('team_share_copied')[0][1]).toMatchObject({ copy_kind: 'message', copy_method: 'manual_fallback' })
  })

  it('events carry kinds and counts, never titles, URLs or the message', async () => {
    const w = await armAndMount('Checkout flow', 3)
    await button(w, 'Copy message').trigger('click')
    await flushPromises()
    await button(w, 'Not now').trigger('click')
    const all = vi.mocked(trackAnalyticsEvent).mock.calls
    expect(all.map(([n]) => n)).toEqual(['team_share_prompt_shown', 'team_share_copied', 'team_share_dismissed'])
    expect(all[0][1]).toMatchObject({
      feature_area: 'team_share',
      surface: 'page_banner',
      has_diagram_title: true,
      site_diagram_count_bucket: '2-5',
    })
    expect(all[1][1]).toMatchObject({ copy_kind: 'message', copy_method: 'clipboard_api' })
    const serialized = JSON.stringify(all)
    for (const secret of ['Checkout flow', 'Checkout service', 'atlassian.net', 'Take a look']) {
      expect(serialized).not.toContain(secret)
    }
  })

  it('closes without showing when nothing is pending', async () => {
    const w = mount(TeamShareBanner)
    await flushPromises()
    expect(w.find('.pb-bar').exists()).toBe(false)
    expect(viewClose).toHaveBeenCalledTimes(1)
    expect(events('team_share_prompt_shown')).toHaveLength(0)
  })

  it('closes, and does not mark shown, when the page lookup fails', async () => {
    api.getPageTitleAndUrl.mockRejectedValue(new Error('403'))
    const w = await armAndMount()
    expect(w.find('.pb-bar').exists()).toBe(false)
    expect(viewClose).toHaveBeenCalledTimes(1)
    expect(isTeamShareShown()).toBe(false)
  })

  it('closes when the page has no title', async () => {
    api.getPageTitleAndUrl.mockResolvedValue({ title: '  ', url: PAGE_URL })
    await armAndMount()
    expect(viewClose).toHaveBeenCalledTimes(1)
  })

  it('a second mount after shown closes at once', async () => {
    await armAndMount()
    viewClose.mockReset()
    const w = mount(TeamShareBanner)
    await flushPromises()
    expect(w.find('.pb-bar').exists()).toBe(false)
    expect(viewClose).toHaveBeenCalledTimes(1)
  })
})
