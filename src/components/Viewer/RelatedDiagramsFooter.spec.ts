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
  MAN: { left: 500, right: 522, top: 40, bottom: 65, width: 22, height: 25 } as DOMRect,
  PA: { left: 100, right: 220, top: 40, bottom: 70, width: 120, height: 30 } as DOMRect,
  U: { left: 260, right: 380, top: 40, bottom: 70, width: 120, height: 30 } as DOMRect,
  GONE: { left: 420, right: 540, top: 40, bottom: 70, width: 120, height: 30 } as DOMRect,
}

function host(): HTMLElement {
  const div = document.createElement('div')
  div.style.position = 'relative'
  div.innerHTML =
    '<svg><rect class="actor actor-top" name="PA"></rect><text name="PA">Partner App</text>' +
    '<rect class="actor actor-top" name="U"></rect><rect class="actor actor-top" name="GONE"></rect>' +
    '<line class="actor-line" name="MAN"></line><g class="actor-man actor-top" name="MAN"></g></svg>'
  Object.defineProperty(div, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left: 20, right: 620, top: 10, bottom: 410, width: 600, height: 400 }),
  })
  div.querySelectorAll<SVGGraphicsElement>('.actor-top').forEach((rect) => {
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

const zenumlRects: Record<string, DOMRect> = {
  OrderController: { left: 60, right: 200, top: 30, bottom: 74, width: 140, height: 44 } as DOMRect,
  'order:Order': { left: 220, right: 340, top: 30, bottom: 74, width: 120, height: 44 } as DOMRect,
}

/** ZenUML renders participants as divs carrying `data-participant-id`; there is no SVG. */
function zenumlHost(): HTMLElement {
  const div = document.createElement('div')
  div.style.position = 'relative'
  div.innerHTML =
    '<div class="participant" data-participant-id="_STARTER_"></div>' +
    '<div class="participant" data-participant-id="OrderController">OrderController</div>' +
    '<div class="participant" data-participant-id="order:Order">order:Order</div>'
  Object.defineProperty(div, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left: 20, right: 620, top: 10, bottom: 410, width: 600, height: 400 }),
  })
  div.querySelectorAll<HTMLElement>('[data-participant-id]').forEach((node) => {
    const rect = zenumlRects[node.getAttribute('data-participant-id')!]
    if (!rect) return
    Object.defineProperty(node, 'getBoundingClientRect', { configurable: true, value: () => rect })
  })
  document.body.appendChild(div)
  return div
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
const arrow = () => document.querySelector<HTMLElement>('.related-diagrams-popover-arrow')
const here = () => document.querySelector<HTMLElement>('[data-testid="related-diagrams-here"]')
const links = () =>
  popover()!.querySelectorAll<HTMLElement>('[data-testid="related-diagram-link"]')
const enterDiagram = (h: HTMLElement) => h.dispatchEvent(new Event('pointerenter'))
const leaveDiagram = (h: HTMLElement) => h.dispatchEvent(new Event('pointerleave'))

beforeEach(() => {
  vi.clearAllMocks()
  // The backend always sends relatedTotal; fixtures that do not care about truncation
  // get "the list is the whole set" so each one states only what it is testing.
  getRelatedDiagrams.mockImplementation(async () => {
    const response = related.value
    if (!response?.participants) return response
    return {
      ...response,
      participants: response.participants.map((participant: any) => ({
        // distinct pages, matching pageTotalsByKey on the backend
        relatedTotal: new Set(participant.related.map((page: any) => page.pageId)).size,
        ...participant,
      })),
    }
  })
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

    expect(wrapper.text()).toContain('1 of 2 participants also appear in other diagrams')
    // the index date is a date with no referent on the line itself; it rides in the tooltip
    expect(wrapper.text()).not.toMatch(/as of \d{1,2} \w{3}/)
    expect(
      wrapper.find('[data-testid="related-diagrams-footer"]').attributes('title'),
    ).toMatch(/^Updated \d{1,2} \w{3}$/)
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
        lookup_outcome: 'indexed',
      }),
    )
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'related_token_indicators_shown',
      expect.objectContaining({ participants_with_related: 1 }),
    )
    expect(
      trackAnalyticsEvent.mock.calls.filter(
        ([eventName]) => eventName === 'related_token_indicators_shown',
      ),
    ).toHaveLength(1)
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

  it('prefers the lookup outcome returned by the backend over the compatibility fallback', async () => {
    related.value = { ...twoParticipants, lookup_outcome: 'index_miss' }
    mountFooter()
    await flushPromises()

    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'related_diagrams_lookup_succeeded',
      expect.objectContaining({ lookup_outcome: 'index_miss' }),
    )
  })

  it('derives index_miss for a successful response from an older backend', async () => {
    related.value = {
      indexedAt: null,
      contentVersion: null,
      participants: [],
    }
    mountFooter()
    await flushPromises()

    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'related_diagrams_lookup_succeeded',
      expect.objectContaining({ lookup_outcome: 'index_miss' }),
    )
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

  it('reveals every related pill on whole-diagram entry and conceals them on leave', async () => {
    related.value = {
      ...twoParticipants,
      participants: [
        twoParticipants.participants[0],
        {
          actorId: 'GONE',
          rawLabel: 'Delivery API',
          related: [{ contentId: '10', pageId: '1000', pageTitle: 'Delivery', spaceKey: 'OP', rawLabelThere: 'Delivery API' }],
        },
        twoParticipants.participants[1],
      ],
    }
    const { h } = mountFooter()
    await flushPromises()

    expect(pill(h, 'PA')!.classList).toContain('related-diagrams-pill--concealed')
    expect(pill(h, 'GONE')!.classList).toContain('related-diagrams-pill--concealed')
    expect(pill(h, 'U')).toBeNull()
    enterDiagram(h)
    await flushPromises()
    expect(pill(h, 'PA')!.classList).not.toContain('related-diagrams-pill--concealed')
    expect(pill(h, 'GONE')!.classList).not.toContain('related-diagrams-pill--concealed')
    expect(popover()).toBeNull()
    expect(pill(h, 'PA')!.title).toBe('Also appears in 2 places — click to see')

    leaveDiagram(h)
    await flushPromises()
    expect(pill(h, 'PA')!.classList).toContain('related-diagrams-pill--concealed')
    expect(pill(h, 'GONE')!.classList).toContain('related-diagrams-pill--concealed')
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
    // the circle sits on the actor box's bottom-right corner
    expect(button.style.left).toBe('190px')
    expect(button.style.top).toBe('52px')
    button.click()
    await flushPromises()
    expect(popover()!.style.left).toBe('100px')
    expect(popover()!.style.top).toBe('86px')
    // the arrow keeps the circle's column
    expect(arrow()!.style.left).toBe('113px')

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
    expect(button.style.left).toBe('260px')
    expect(button.style.top).toBe('72px')
    expect(popover()!.style.left).toBe('150px')
    expect(popover()!.style.top).toBe('106px')
  })

  it('shifts and flips an edge popover into the viewport instead of clipping it in the diagram', async () => {
    related.value = twoParticipants
    const { h } = mountFooter()
    await flushPromises()
    actorRects.PA = {
      left: 900,
      right: 1020,
      top: 720,
      bottom: 750,
      width: 120,
      height: 30,
    } as DOMRect
    window.dispatchEvent(new Event('resize'))
    enterDiagram(h)
    await flushPromises()

    pill(h, 'PA')!.click()
    await flushPromises()

    expect(popover()!.parentElement).toBe(document.body)
    expect(popover()!.style.left).toBe('696px')
    expect(popover()!.style.top).toBe('432px')
    // flipped above: the arrow moves to the lower edge and stays inside the shell
    expect(arrow()!.classList.contains('related-diagrams-popover-arrow--under')).toBe(true)
    expect(arrow()!.style.left).toBe('302px')
  })

  it('opens only on a visible pill click, applies the blue actor outline, and second click closes', async () => {
    related.value = twoParticipants
    const { h } = mountFooter()
    await flushPromises()

    enterDiagram(h)
    await flushPromises()
    const button = pill(h, 'PA')!
    button.click()
    await flushPromises()
    const pop = popover()!
    expect(pop.textContent).toContain('Also appears in')
    expect(pop.textContent).toContain('Checkout')
    expect(pop.textContent).toContain('Refunds')
    // no participant name, space key, label variant, or inference wording
    expect(pop.textContent).not.toContain('Partner App')
    expect(pop.textContent).not.toContain('VPAY')
    expect(pop.textContent).not.toContain('PartnerApp')
    expect(pop.textContent).not.toContain('Possibly related by name')
    expect(pop.textContent).not.toContain('Same name, not proof of the same object')
    expect(button.classList).not.toContain('related-diagrams-pill--concealed')
    expect(button.getAttribute('aria-expanded')).toBe('true')
    const highlight = h.querySelector<HTMLElement>('[data-testid="related-diagrams-highlight"]')!
    expect(highlight.style.outline).toContain('#0052CC')
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'related_diagram_popover_opened',
      expect.objectContaining({ related_count: 2, label_variant_count: 2, same_page: false }),
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
    expect(popover()!.textContent).toContain('Checkout')

    pill(h, 'GONE')!.click()
    await flushPromises()
    expect(popover()!.textContent).toContain('Delivery status')
    expect(popover()!.textContent).not.toContain('Checkout')
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
      expect.objectContaining({ related_count: 2, same_space: false }),
    )

    links[1].click()
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'related_diagram_link_clicked',
      expect.objectContaining({ related_count: 2, same_space: true }),
    )
  })

  it('states the relation instead of a page title when a related diagram is on the current page', async () => {
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

    expect(here()!.textContent!.trim()).toBe('Another diagram on this page')
    // it opens nothing, so it is not a link, and the page title would repeat the screen
    expect(links()).toHaveLength(0)
    expect(popover()!.textContent).not.toContain('Current page diagram')
    expect(pill(h, 'PA')!.textContent!.trim()).toBe('1')
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'related_diagram_popover_opened',
      expect.objectContaining({ related_count: 1, same_page: true }),
    )
  })

  it('collapses two related diagrams on the current page into one plural row', async () => {
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
            {
              contentId: '5',
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

    expect(here()!.textContent!.trim()).toBe('Other diagrams on this page')
    expect(pill(h, 'PA')!.textContent!.trim()).toBe('1')
  })

  it('lists one row per page when a page holds two related diagrams', async () => {
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
              pageId: '300',
              pageTitle: 'Refunds',
              spaceKey: 'OP',
              rawLabelThere: 'Partner App',
            },
            {
              contentId: '5',
              pageId: '300',
              pageTitle: 'Refunds',
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

    expect(links()).toHaveLength(1)
    expect(pill(h, 'PA')!.textContent!.trim()).toBe('1')
  })

  it('lists the current page first, above the pages that open', async () => {
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
              pageId: '300',
              pageTitle: 'Refunds',
              spaceKey: 'OP',
              rawLabelThere: 'Partner App',
            },
            {
              contentId: '5',
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

    const rows = popover()!.querySelectorAll('li')
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent!.trim()).toBe('Another diagram on this page')
    expect(rows[1].textContent!.trim()).toBe('Refunds')
    expect(pill(h, 'PA')!.textContent!.trim()).toBe('2')
  })

  it('anchors a circle on an actor-shaped participant, which Mermaid draws without a rect', async () => {
    related.value = {
      indexedAt: twoParticipants.indexedAt,
      contentVersion: twoParticipants.contentVersion,
      participants: [
        {
          actorId: 'MAN',
          rawLabel: 'Developer',
          related: [
            {
              contentId: '7',
              pageId: '700',
              pageTitle: 'Access review',
              spaceKey: 'OP',
              rawLabelThere: 'Developer',
            },
          ],
        },
      ],
    }
    const { h } = mountFooter({ pageId: '999' })
    await flushPromises()

    // g.actor-man.actor-top carries the name; matching only rect.actor-top dropped it,
    // so the footer counted a participant whose circle never appeared
    const button = pill(h, 'MAN')!
    expect(button).not.toBeNull()
    expect(button.style.left).toBe('492px')
    expect(button.style.top).toBe('47px')
  })

  it('reads a ZenUML diagram, which marks lifelines with data-participant-id and has no SVG', async () => {
    related.value = {
      indexedAt: twoParticipants.indexedAt,
      contentVersion: twoParticipants.contentVersion,
      participants: [
        {
          actorId: 'OrderController',
          rawLabel: 'OrderController',
          related: [
            {
              contentId: '8',
              pageId: '800',
              pageTitle: 'Order intake',
              spaceKey: 'OP',
              rawLabelThere: 'OrderController',
            },
          ],
        },
        {
          actorId: 'order:Order',
          rawLabel: 'order:Order',
          related: [
            {
              contentId: '9',
              pageId: '900',
              pageTitle: 'Order model',
              spaceKey: 'OP',
              rawLabelThere: 'order:Order',
            },
          ],
        },
        // absent from this diagram: it must not produce a circle
        { actorId: 'Ghost', rawLabel: 'Ghost', related: [{ contentId: '10', pageId: '1000', pageTitle: 'X', spaceKey: 'OP', rawLabelThere: 'Ghost' }] },
      ],
    }
    const { h, wrapper } = mountFooter({ pageId: '999' }, zenumlHost())
    await flushPromises()

    expect(wrapper.text()).toContain('2 of 2 participants also appear in other diagrams')
    expect(pill(h, 'Ghost')).toBeNull()
    const button = pill(h, 'OrderController')!
    expect(button.textContent!.trim()).toBe('1')
    expect(button.style.left).toBe('170px')
    expect(button.style.top).toBe('56px')
    // a colon in the id is a valid ZenUML declaration name and must survive the selector
    expect(pill(h, 'order:Order')).not.toBeNull()

    button.click()
    await flushPromises()
    expect(popover()!.textContent).toContain('Order intake')
  })

  it('closes the list with the number of places it does not show', async () => {
    related.value = {
      indexedAt: twoParticipants.indexedAt,
      contentVersion: twoParticipants.contentVersion,
      participants: [
        {
          actorId: 'PA',
          rawLabel: 'Partner App',
          // `user` sits on 139 pages at the pilot tenant; the backend sends the nearest few
          relatedTotal: 139,
          related: [
            { contentId: '2', pageId: '200', pageTitle: 'Checkout', spaceKey: 'OP', rawLabelThere: 'Partner App' },
            { contentId: '3', pageId: '300', pageTitle: 'Refunds', spaceKey: 'OP', rawLabelThere: 'Partner App' },
          ],
        },
      ],
    }
    const { h } = mountFooter({ pageId: '999' })
    await flushPromises()

    // the circle reports the reach of the name, not the length of the list
    expect(pill(h, 'PA')!.textContent!.trim()).toBe('139')
    pill(h, 'PA')!.click()
    await flushPromises()

    const rows = [...popover()!.querySelectorAll('li')].map((li) => li.textContent!.trim())
    expect(rows).toEqual(['Checkout', 'Refunds', '137 more places'])
    // the closing line is not a link
    expect(links()).toHaveLength(2)
  })

  it('uses the singular when one place is left out', async () => {
    related.value = {
      indexedAt: twoParticipants.indexedAt,
      contentVersion: twoParticipants.contentVersion,
      participants: [
        {
          actorId: 'PA',
          rawLabel: 'Partner App',
          relatedTotal: 2,
          related: [
            { contentId: '2', pageId: '200', pageTitle: 'Checkout', spaceKey: 'OP', rawLabelThere: 'Partner App' },
          ],
        },
      ],
    }
    const { h } = mountFooter({ pageId: '999' })
    await flushPromises()
    pill(h, 'PA')!.click()
    await flushPromises()
    expect(popover()!.textContent).toContain('1 more place')
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
    expect(trackAnalyticsEvent).not.toHaveBeenCalledWith(
      'related_diagrams_lookup_succeeded',
      expect.anything(),
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
    expect(trackAnalyticsEvent).not.toHaveBeenCalledWith(
      'related_diagrams_lookup_succeeded',
      expect.anything(),
    )
  })
})
