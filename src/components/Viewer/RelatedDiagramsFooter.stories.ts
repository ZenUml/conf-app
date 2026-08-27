// Root tsc uses legacy Node resolution; Storybook 10 exposes these through
// package exports. The Storybook/Vite build resolves them (as existing stories do).
// @ts-expect-error -- resolved by Storybook's Vite pipeline
import type { Args, Meta, StoryObj } from '@storybook/vue3-vite'
// @ts-expect-error -- resolved by Storybook's Vite pipeline
import { expect, userEvent, waitFor, within } from 'storybook/test'
import mixpanel from 'mixpanel-browser'
import RelatedDiagramsFooter from './RelatedDiagramsFooter.vue'
import forgeGlobal from '@/model/globals/forgeGlobal'
import { resetStubResponses, stubResponses } from '@/stubs/forge-bridge'

/**
 * Architecture Tokens Phase 1's progressive reveal in isolation from the full
 * viewer: unchanged diagram by default, one quiet footer after lookup, one pill
 * on actor hover, and the name-cautious popover only after a pill click.
 *
 * Every title, label, id, and space below is invented. The remote lookup uses
 * Storybook's existing @forge/bridge alias, so no Forge or customer system is
 * contacted.
 */

const RELATED_RESPONSE = {
  indexedAt: '2026-08-27T00:00:00.000Z',
  contentVersion: 4,
  participants: [
    { actorId: 'WEB', rawLabel: 'Web App', related: [] },
    {
      actorId: 'PA',
      rawLabel: 'Partner App',
      related: [
        {
          contentId: 'related-101',
          pageId: 'page-101',
          pageTitle: 'Checkout — order flow',
          spaceKey: 'VPAY',
          rawLabelThere: 'PartnerApp',
        },
        {
          contentId: 'related-102',
          pageId: 'page-102',
          pageTitle: 'Refund handling',
          spaceKey: 'VPAY',
          rawLabelThere: 'Partner App',
        },
        {
          contentId: 'related-103',
          pageId: 'page-103',
          pageTitle: 'Partner onboarding',
          spaceKey: 'OP',
          rawLabelThere: 'partner-app',
        },
      ],
    },
    {
      actorId: 'PAY',
      rawLabel: 'Payments API',
      related: [
        {
          contentId: 'related-201',
          pageId: 'page-201',
          pageTitle: 'Payment authorization',
          spaceKey: 'VPAY',
          rawLabelThere: 'PaymentsAPI',
        },
        {
          contentId: 'related-202',
          pageId: 'page-202',
          pageTitle: 'Settlement overview',
          spaceKey: 'FIN',
          rawLabelThere: 'payments_api',
        },
        {
          contentId: 'related-203',
          pageId: 'page-203',
          pageTitle: 'Payment retries',
          spaceKey: 'OP',
          rawLabelThere: 'Payments API',
        },
        {
          contentId: 'related-204',
          pageId: 'page-204',
          pageTitle: 'Gateway migration',
          spaceKey: 'FIN',
          rawLabelThere: 'Payments API',
        },
      ],
    },
    {
      actorId: 'LEDGER',
      rawLabel: 'Ledger Service',
      related: [
        {
          contentId: 'related-301',
          pageId: 'page-301',
          pageTitle: 'Ledger posting',
          spaceKey: 'FIN',
          rawLabelThere: 'Ledger Service',
        },
        {
          contentId: 'related-302',
          pageId: 'page-302',
          pageTitle: 'Reconciliation flow',
          spaceKey: 'OP',
          rawLabelThere: 'LedgerService',
        },
      ],
    },
    {
      actorId: 'NOTIF',
      rawLabel: 'Notification Service',
      related: [
        {
          contentId: 'related-401',
          pageId: 'page-401',
          pageTitle: 'Receipt notifications',
          spaceKey: 'OP',
          rawLabelThere: 'Notification Service',
        },
      ],
    },
    {
      actorId: 'DB',
      rawLabel: 'Orders DB',
      related: [
        {
          contentId: 'related-501',
          pageId: 'page-501',
          pageTitle: 'Order persistence',
          spaceKey: 'OP',
          rawLabelThere: 'OrdersDB',
        },
        {
          contentId: 'related-502',
          pageId: 'page-502',
          pageTitle: 'Archive jobs',
          spaceKey: 'DATA',
          rawLabelThere: 'Orders DB',
        },
      ],
    },
    { actorId: 'OPS', rawLabel: 'Ops', related: [] },
  ],
}

const ACTORS = [
  ['WEB', 'Web App'],
  ['PA', 'Partner App'],
  ['PAY', 'Payments API'],
  ['LEDGER', 'Ledger Service'],
  ['NOTIF', 'Notification Service'],
  ['DB', 'Orders DB'],
  ['OPS', 'Ops'],
] as const

function configureStory(withLookup: boolean) {
  resetStubResponses()
  if (withLookup) {
    stubResponses.remote = [
      { match: '/api/architecture-tokens/related', body: RELATED_RESPONSE },
    ]
  }
  forgeGlobal.isForge = false
  forgeGlobal.isLite = true
  forgeGlobal.zenumlRemoteBaseUrl = 'https://storybook.invalid'
  forgeGlobal.forgeContext = {
    siteUrl: 'https://example.atlassian.net',
    extension: { content: { id: 'storybook-page' }, space: { key: 'OP' } },
  }

  // Storybook has no analytics token. Keep the console clean while exercising
  // the real component event calls.
  const noop = () => {}
  ;(mixpanel as any).init = noop
  ;(mixpanel as any).register = noop
  ;(mixpanel as any).track = noop
}

function renderStory(args: Args) {
  return {
    components: { RelatedDiagramsFooter },
    data() {
      return { actors: ACTORS, args }
    },
    methods: {
      svgHost(this: any) {
        return (this.$refs.hostRef as HTMLElement | undefined) ?? null
      },
    },
    template: `
      <div
        :class="['architecture-token-story', { 'architecture-token-story--fullscreen': args.surface === 'fullscreen' }]"
      >
        <div ref="hostRef" class="architecture-token-story__diagram">
          <svg viewBox="0 0 1120 440" role="img" aria-label="Invented checkout sequence diagram">
            <g v-for="(actor, index) in actors" :key="actor[0]">
              <rect
                class="actor actor-top"
                :name="actor[0]"
                :x="24 + index * 158"
                y="22"
                width="132"
                height="34"
                rx="3"
                fill="#EAE6FF"
                stroke="#6554C0"
              />
              <text
                :name="actor[0]"
                :x="90 + index * 158"
                y="44"
                text-anchor="middle"
                font-size="12"
                fill="#172B4D"
              >{{ actor[1] }}</text>
              <line
                :x1="90 + index * 158"
                y1="56"
                :x2="90 + index * 158"
                y2="416"
                stroke="#C1C7D0"
                stroke-dasharray="4 4"
              />
            </g>
            <g fill="none" stroke="#172B4D" stroke-width="1.25">
              <path d="M90 104 H400" />
              <path d="M394 100 L400 104 L394 108" />
              <path d="M400 158 H710" />
              <path d="M704 154 L710 158 L704 162" />
              <path d="M710 212 H868" />
              <path d="M862 208 L868 212 L862 216" />
              <path d="M868 266 H1026" />
              <path d="M1020 262 L1026 266 L1020 270" />
              <path d="M1026 326 H400" stroke-dasharray="5 4" />
              <path d="M406 322 L400 326 L406 330" />
            </g>
            <g fill="#172B4D" font-size="12" text-anchor="middle">
              <text x="245" y="96">Submit order</text>
              <text x="555" y="150">Authorize payment</text>
              <text x="789" y="204">Record transaction</text>
              <text x="947" y="258">Save order</text>
              <text x="713" y="318">Order accepted</text>
            </g>
          </svg>
        </div>
        <div class="architecture-token-story__footer-row">
          <RelatedDiagramsFooter
            v-bind="args"
            :svg-host="svgHost"
          />
          <div class="architecture-token-story__attribution">Created by Example Author</div>
        </div>
      </div>
    `,
  }
}

const meta: Meta<typeof RelatedDiagramsFooter> = {
  title: 'Viewer/Related diagrams footer',
  component: RelatedDiagramsFooter,
  parameters: { layout: 'fullscreen' },
  decorators: [
    () => ({
      template: '<div style="padding: 24px; background: #FAFBFC;"><story/></div>',
    }),
  ],
  args: {
    customContentId: 'storybook-custom-content',
    ready: true,
    enabled: true,
    surface: 'viewer',
    pageId: 'storybook-page',
    svgHost: () => null,
  },
  render: renderStory,
}

export default meta
type Story = StoryObj<typeof RelatedDiagramsFooter>

/** Flag off: the existing diagram and attribution are completely unchanged. */
export const Default: Story = {
  args: { enabled: false },
  decorators: [
    () => {
      configureStory(false)
      return { template: '<story/>' }
    },
  ],
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryByTestId('related-diagrams-footer')).not.toBeInTheDocument()
    expect(canvas.queryByTestId('related-diagrams-pill')).not.toBeInTheDocument()
  },
}

/** Successful lookup: only the quiet 5-of-7 footer appears; the diagram stays clean. */
export const LookupResultFooter: Story = {
  decorators: [
    () => {
      configureStory(true)
      return { template: '<story/>' }
    },
  ],
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByText(/5 of 7 participants also appear in other diagrams you can access/),
    ).toBeVisible()
    const pills = await canvas.findAllByTestId('related-diagrams-pill')
    expect(pills).toHaveLength(5)
    pills.forEach((pill: HTMLElement) => expect(pill).not.toBeVisible())
  },
}

/** Hovering Partner App reveals its count pill and still opens no popover. */
export const HoverPill: Story = {
  decorators: [
    () => {
      configureStory(true)
      return { template: '<story/>' }
    },
  ],
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByText(/5 of 7 participants/)
    const actor = canvasElement.querySelector<SVGRectElement>('rect.actor-top[name="PA"]')!
    await userEvent.hover(actor)
    const partnerPill = canvasElement.querySelector<HTMLButtonElement>(
      '[data-testid="related-diagrams-pill"][data-actor="PA"]',
    )!
    await waitFor(() => expect(partnerPill).toBeVisible())
    expect(partnerPill).toHaveTextContent('3')
    expect(partnerPill).toHaveAttribute(
      'title',
      '3 related diagrams you can access — click to see',
    )
    expect(canvas.queryByRole('dialog')).not.toBeInTheDocument()
  },
}

/** A pill click opens the cautious name-only relationship detail. */
export const PopoverOpen: Story = {
  decorators: [
    () => {
      configureStory(true)
      return { template: '<story/>' }
    },
  ],
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByText(/5 of 7 participants/)
    const actor = canvasElement.querySelector<SVGRectElement>('rect.actor-top[name="PA"]')!
    await userEvent.hover(actor)
    const partnerPill = canvasElement.querySelector<HTMLButtonElement>(
      '[data-testid="related-diagrams-pill"][data-actor="PA"]',
    )!
    await waitFor(() => expect(partnerPill).toBeVisible())
    await userEvent.click(partnerPill)
    const dialog = await canvas.findByRole('dialog', { name: 'Possibly related by name' })
    expect(dialog).toHaveTextContent('Partner App')
    expect(dialog).toHaveTextContent('Checkout — order flow')
    expect(dialog).toHaveTextContent('as PartnerApp')
    expect(dialog).toHaveTextContent('Same name, not proof of the same object')
    expect(partnerPill).toHaveAttribute('aria-expanded', 'true')
    expect(canvas.getByTestId('related-diagrams-highlight')).toBeVisible()
  },
}

/** The same behavior in a presentation-sized fullscreen frame, footer pinned low. */
export const Fullscreen: Story = {
  args: { surface: 'fullscreen' },
  decorators: [
    () => {
      configureStory(true)
      return { template: '<story/>' }
    },
  ],
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByText(/5 of 7 participants/)
    const actor = canvasElement.querySelector<SVGRectElement>('rect.actor-top[name="PAY"]')!
    await userEvent.hover(actor)
    const paymentsPill = canvasElement.querySelector<HTMLButtonElement>(
      '[data-testid="related-diagrams-pill"][data-actor="PAY"]',
    )!
    await waitFor(() => expect(paymentsPill).toBeVisible())
    await userEvent.click(paymentsPill)
    expect(await canvas.findByRole('dialog')).toHaveTextContent('Payments API')
    expect(paymentsPill).toHaveTextContent('4')
  },
}

// Story-only layout mirrors the approved inline and fullscreen placements.
const style = document.createElement('style')
style.textContent = `
  .architecture-token-story {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-width: 960px;
    border: 1px solid #E5E7EB;
    border-radius: 6px;
    background: #FFFFFF;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  .architecture-token-story--fullscreen { min-height: 820px; border-radius: 0; }
  .architecture-token-story__diagram {
    position: relative;
    flex: 1;
    padding: 28px 22px 10px;
    background: #FFFFFF;
  }
  .architecture-token-story__diagram > svg { display: block; width: 100%; height: auto; }
  .architecture-token-story__footer-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-top: 1px solid #E5E7EB;
  }
  .architecture-token-story__attribution {
    padding: 8px 12px;
    color: #6b7280;
    font-size: 12px;
    text-align: right;
  }
`
if (!document.querySelector('[data-related-diagrams-story-styles]')) {
  style.dataset.relatedDiagramsStoryStyles = ''
  document.head.appendChild(style)
}
