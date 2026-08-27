import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { related, getRelatedDiagrams, trackAnalyticsEvent, openUrl } = vi.hoisted(() => {
  const response = { value: null as any }
  return {
    related: response,
    getRelatedDiagrams: vi.fn(async () => response.value),
    trackAnalyticsEvent: vi.fn(),
    openUrl: vi.fn(),
  }
})

vi.mock('@/services/ArchitectureTokens', () => ({
  getRelatedDiagrams,
  RelatedLookupError: class extends Error {
    constructor(public kind: string) {
      super(kind)
    }
  },
}))
vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent }))
vi.mock('@/model/globals/forgeGlobal', () => ({
  openUrl,
  default: {
    forgeContext: {
      siteUrl: 'https://example.atlassian.net',
      extension: { space: { key: 'OP' } },
    },
  },
}))

import { RelatedLookupError } from '@/services/ArchitectureTokens'
import RelatedDiagramsFooter from './RelatedDiagramsFooter.vue'

const actorRects: Record<string, DOMRect> = {
  PA: { left: 100, right: 220, top: 40, bottom: 70, width: 120, height: 30 } as DOMRect,
  U: { left: 260, right: 380, top: 40, bottom: 70, width: 120, height: 30 } as DOMRect,
  GONE: { left: 420, right: 540, top: 40, bottom: 70, width: 120, height: 30 } as DOMRect,
}

function host(): HTMLElement {
  const div = document.createElement('div')
  div.style.position = 'relative'
  div.innerHTML =
    '<svg><rect class="actor actor-top" name="PA"></rect><text name="PA">Partner App</text>' +
    '<rect class="actor actor-top" name="U"></rect><rect class="actor actor-top" name="GONE"></rect></svg>'
  Object.defineProperty(div, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left: 20, right: 620, top: 10, bottom: 410, width: 600, height: 400 }),
  })
  div.querySelectorAll<SVGRectElement>('rect.actor-top').forEach((rect) => {
    Object.defineProperty(rect, 'getBoundingClientRect', {
      configurable: true,
      value: () => actorRects[rect.getAttribute('name')!],
    })
  })
  document.body.appendChild(div)
  return div
}

const twoParticipants = {
  indexedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
  contentVersion: 1,
  participants: [
    {
      actorId: 'PA',
      rawLabel: 'Partner App',
      related: [
        {
          contentId: '2',
          pageId: '200',
          pageTitle: 'Checkout',
          spaceKey: 'VPAY',
          rawLabelThere: 'PartnerApp',
        },
        {
          contentId: '3',
          pageId: '300',
          pageTitle: 'Refunds',
          spaceKey: 'OP',
          rawLabelThere: 'Partner App',
        },
      ],
    },
    { actorId: 'U', rawLabel: 'User', related: [] },
    {
      actorId: 'RENAMED',
      rawLabel: 'Old Name',
      related: [
        {
          contentId: '9',
          pageId: '900',
          pageTitle: 'X',
          spaceKey: 'OP',
          rawLabelThere: 'Old Name',
        },
      ],
    },
  ],
}

function mountFooter(props: Partial<any> = {}, suppliedHost = host()) {
  const wrapper = mount(RelatedDiagramsFooter, {
    props: {
      customContentId: '1',
      ready: true,
      enabled: true,
      surface: 'viewer',
      svgHost: () => suppliedHost,
      ...props,
    },
    attachTo: document.body,
  })
  return { h: suppliedHost, wrapper }
}

const pill = (h: HTMLElement, actor: string) =>
  h.querySelector<HTMLButtonElement>(
    `[data-testid="related-diagrams-pill"][data-actor="${actor}"]`,
  )
const popover = () => document.querySelector<HTMLElement>('[data-testid="related-diagrams-popover"]')

beforeEach(() => {
  vi.clearAllMocks()
  getRelatedDiagrams.mockImplementation(async () => related.value)
  document.body.innerHTML = ''
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('RelatedDiagramsFooter', () => {
  it('renders counts, date, and one pill per related lifeline present in the current SVG', async () => {
    related.value = twoParticipants
    const { wrapper, h } = mountFooter()
    await flushPromises()

    expect(wrapper.text()).toContain(
      '1 of 2 participants also appear in other diagrams you can access',
    )
    expect(wrapper.text()).toMatch(/as of \d{1,2} \w{3}/)
    expect(pill(h, 'PA')?.textContent?.trim()).toBe('2')
    expect(pill(h, 'U')).toBeNull()
    expect(pill(h, 'RENAMED')).toBeNull()
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'related_diagrams_lookup_succeeded',
      expect.objectContaining({
        feature_area: 'architecture_tokens',
        surface: 'viewer',
        macro_type: 'mermaid',
        participant_count: 2,
        participants_with_related: 1,
        related_pages_total: 2,
        index_age_days: 3,
      }),
    )
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'related_diagrams_shown',
      expect.objectContaining({ participants_with_related: 1 }),
    )
  })

  it('drops every response participant when the current SVG has no [name] nodes', async () => {
    related.value = twoParticipants
    const emptyHost = document.createElement('div')
    emptyHost.innerHTML = '<svg><rect class="actor actor-top"></rect></svg>'
    document.body.appendChild(emptyHost)
    const { wrapper } = mountFooter({}, emptyHost)
    await flushPromises()

    expect(wrapper.find('[data-testid="related-diagrams-footer"]').exists()).toBe(false)
    expect(emptyHost.querySelector('[data-testid="related-diagrams-pill"]')).toBeNull()
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'related_diagrams_lookup_succeeded',
      expect.objectContaining({ participant_count: 0, participants_with_related: 0 }),
    )
  })

  it('renders nothing and fires only lookup_succeeded when no present participant has related pages', async () => {
    related.value = {
      ...twoParticipants,
      participants: [{ actorId: 'PA', rawLabel: 'Partner App', related: [] }],
    }
    const { wrapper, h } = mountFooter()
    await flushPromises()

    expect(wrapper.find('[data-testid="related-diagrams-footer"]').exists()).toBe(false)
    expect(h.querySelector('[data-testid="related-diagrams-pill"]')).toBeNull()
    expect(trackAnalyticsEvent).toHaveBeenCalledTimes(1)
  })

  it('calls the service once only after both ready and enabled become true', async () => {
    related.value = twoParticipants
    const { wrapper } = mountFooter({ ready: false, enabled: false })
    await flushPromises()
    expect(getRelatedDiagrams).not.toHaveBeenCalled()

    await wrapper.setProps({ ready: true })
    await flushPromises()
    expect(getRelatedDiagrams).not.toHaveBeenCalled()

    await wrapper.setProps({ enabled: true })
    await flushPromises()
    expect(getRelatedDiagrams).toHaveBeenCalledTimes(1)

    await wrapper.setProps({ ready: false })
    await wrapper.setProps({ ready: true })
    await flushPromises()
    expect(getRelatedDiagrams).toHaveBeenCalledTimes(1)
  })

  it('shows related pills immediately and hover never opens a popover', async () => {
    related.value = twoParticipants
    const { h } = mountFooter()
    await flushPromises()

    expect(pill(h, 'PA')!.classList).not.toContain('related-diagrams-pill--concealed')
    expect(pill(h, 'U')).toBeNull()
    h.querySelector('rect[name="PA"]')!.dispatchEvent(
      new MouseEvent('mouseover', { bubbles: true }),
    )
    await flushPromises()
    expect(popover()).toBeNull()
    expect(pill(h, 'PA')!.title).toBe('2 related diagrams you can access — click to see')
  })

  it('gives an immediately visible pill a keyboard focus treatment', async () => {
    related.value = twoParticipants
    const { h } = mountFooter()
    await flushPromises()

    const button = pill(h, 'PA')!
    button.focus()
    await flushPromises()
    expect(button.classList.contains('related-diagrams-pill')).toBe(true)
  })

  it('positions pills and open popover from the actor box and recomputes on resize', async () => {
    related.value = twoParticipants
    const { h } = mountFooter()
    await flushPromises()

    const button = pill(h, 'PA')!
    expect(button.style.left).toBe('188px')
    expect(button.style.top).toBe('21px')
    button.click()
    await flushPromises()
    expect(popover()!.style.left).toBe('80px')
    expect(popover()!.style.top).toBe('68px')

    actorRects.PA = {
      left: 150,
      right: 290,
      top: 60,
      bottom: 90,
      width: 140,
      height: 30,
    } as DOMRect
    window.dispatchEvent(new Event('resize'))
    await flushPromises()
    expect(button.style.left).toBe('258px')
    expect(button.style.top).toBe('41px')
    expect(popover()!.style.left).toBe('130px')
    expect(popover()!.style.top).toBe('88px')
  })

  it('opens only on pill click, applies the blue actor outline, and second click closes', async () => {
    related.value = twoParticipants
    const { h } = mountFooter()
    await flushPromises()

    const button = pill(h, 'PA')!
    button.click()
    await flushPromises()
    const pop = popover()!
    expect(pop.textContent).toContain('Possibly related by name')
    expect(pop.textContent).toContain('Checkout')
    expect(pop.textContent).toContain('VPAY')
    expect(pop.textContent).toContain('as PartnerApp')
    expect(pop.textContent).not.toContain('as Partner App')
    expect(pop.textContent).toContain('Same name, not proof of the same object')
    expect(button.classList).not.toContain('related-diagrams-pill--concealed')
    expect(button.getAttribute('aria-expanded')).toBe('true')
    const highlight = h.querySelector<HTMLElement>('[data-testid="related-diagrams-highlight"]')!
    expect(highlight.style.outline).toContain('#0052CC')
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'related_diagram_popover_opened',
      expect.objectContaining({ related_count: 2, label_variant_count: 2 }),
    )

    button.click()
    await flushPromises()
    expect(popover()).toBeNull()
    expect(h.querySelector('[data-testid="related-diagrams-highlight"]')).toBeNull()
  })

  it('closes on Escape or outside mousedown but not on a mousedown inside', async () => {
    related.value = twoParticipants
    const { h } = mountFooter()
    await flushPromises()
    const button = pill(h, 'PA')!

    button.click()
    await flushPromises()
    popover()!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await flushPromises()
    expect(popover()).not.toBeNull()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(popover()).toBeNull()

    button.click()
    await flushPromises()
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await flushPromises()
    expect(popover()).toBeNull()
  })

  it('switches the open popover when another related lifeline pill is clicked', async () => {
    related.value = {
      ...twoParticipants,
      participants: [
        twoParticipants.participants[0],
        {
          actorId: 'GONE',
          rawLabel: 'Delivery API',
          related: [
            {
              contentId: '10',
              pageId: '1000',
              pageTitle: 'Delivery status',
              spaceKey: 'OP',
              rawLabelThere: 'DeliveryAPI',
            },
          ],
        },
      ],
    }
    const { h } = mountFooter()
    await flushPromises()

    pill(h, 'PA')!.click()
    await flushPromises()
    expect(popover()!.textContent).toContain('Partner App')

    pill(h, 'GONE')!.click()
    await flushPromises()
    expect(popover()!.textContent).toContain('Delivery API')
    expect(popover()!.textContent).not.toContain('Partner App')
  })

  it('keeps the popover click-only after a touchstart', async () => {
    related.value = twoParticipants
    const { h } = mountFooter()
    await flushPromises()
    const button = pill(h, 'PA')!

    button.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true }))
    await flushPromises()
    expect(popover()).toBeNull()

    button.click()
    await flushPromises()
    expect(popover()).not.toBeNull()
  })

  it('opens a page through openUrl and records whether it is in the current space', async () => {
    related.value = twoParticipants
    const { h } = mountFooter({ pageId: '999' })
    await flushPromises()
    pill(h, 'PA')!.click()
    await flushPromises()

    const links = popover()!.querySelectorAll<HTMLElement>('[data-testid="related-diagram-link"]')
    links[0].click()
    expect(openUrl).toHaveBeenCalledWith(
      'https://example.atlassian.net/wiki/pages/viewpage.action?pageId=200',
    )
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'related_diagram_link_clicked',
      expect.objectContaining({ related_count: 2, same_space: false, same_page: false }),
    )

    links[1].click()
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'related_diagram_link_clicked',
      expect.objectContaining({ related_count: 2, same_space: true, same_page: false }),
    )
  })

  it('labels a related diagram on the current page as This page', async () => {
    related.value = {
      indexedAt: twoParticipants.indexedAt,
      contentVersion: twoParticipants.contentVersion,
      participants: [
        {
          actorId: 'PA',
          rawLabel: 'Partner App',
          related: [
            {
              contentId: '4',
              pageId: '999',
              pageTitle: 'Current page diagram',
              spaceKey: 'OP',
              rawLabelThere: 'Partner App',
            },
          ],
        },
      ],
    }
    const { h } = mountFooter({ pageId: '999' })
    await flushPromises()
    pill(h, 'PA')!.click()
    await flushPromises()

    const links = popover()!.querySelectorAll<HTMLElement>('[data-testid="related-diagram-link"]')
    expect(links).toHaveLength(1)
    expect(links[0].textContent).toContain('Current page diagram')
    expect(
      links[0].querySelector('[data-testid="related-diagrams-current-page"]')?.textContent?.trim(),
    ).toBe('This page')
    links[0].click()
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'related_diagram_link_clicked',
      expect.objectContaining({ same_page: true }),
    )
  })

  it('keeps a thrown lookup failure silent and records its error kind', async () => {
    getRelatedDiagrams.mockRejectedValueOnce(new RelatedLookupError('timeout'))
    const { wrapper } = mountFooter()
    await flushPromises()

    expect(wrapper.find('[data-testid="related-diagrams-footer"]').exists()).toBe(false)
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'related_diagrams_lookup_failed',
      expect.objectContaining({ error_kind: 'timeout' }),
    )
  })

  it('keeps a response-level failure silent and records its error kind', async () => {
    related.value = {
      indexedAt: null,
      contentVersion: null,
      participants: [],
      error_kind: 'confluence_unavailable',
    }
    const { wrapper } = mountFooter()
    await flushPromises()

    expect(wrapper.find('[data-testid="related-diagrams-footer"]').exists()).toBe(false)
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'related_diagrams_lookup_failed',
      expect.objectContaining({ error_kind: 'confluence_unavailable' }),
    )
  })
})
