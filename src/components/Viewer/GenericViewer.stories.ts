// Root tsc uses legacy Node resolution; Storybook 10 exposes these through
// package exports. The Storybook/Vite build resolves them.
// @ts-expect-error -- resolved by Storybook's Vite pipeline
import { setup, type Args, type Meta, type StoryObj } from '@storybook/vue3-vite'
// @ts-expect-error -- resolved by Storybook's Vite pipeline
import { expect, userEvent, waitFor, within } from 'storybook/test'
import mixpanel from 'mixpanel-browser'
import { FeatureFlags } from '@forge/bridge'
import GenericViewer from './GenericViewer.vue'
import Mermaid from '@/components/Mermaid.vue'
import store from '@/model/store2'
import globals from '@/model/globals'
import forgeGlobal from '@/model/globals/forgeGlobal'
import { DataSource, DiagramType } from '@/model/Diagram/Diagram'
import { resetAiTitleFlagForTests } from '@/apis/aiTitleFeatureFlag'
import { resetStubResponses, stubResponses } from '@/stubs/forge-bridge'
import { __resetMermaidLoaderForTests, loadMermaid } from '@/utils/mermaid/loadMermaid'

// Header.stories.ts's `{ template: '<story/>', app: (app) => app.use(store) }`
// decorator idiom does NOT install the plugin on @storybook/vue3-vite 10.4's
// actual root Vue app (verified live: mapState/mapGetters throw "Cannot read
// properties of undefined (reading 'state'/'getters')" — Header.stories.ts
// has the same bug). The framework's real extension point is `setup()`
// (@storybook/vue3's src/render.ts): it registers a callback Storybook runs
// against the real root app right before `vueApp.mount()`. Called once at
// module load (ES modules only evaluate once).
setup((app: { use(plugin: typeof store): unknown }) => {
  app.use(store)
})

/**
 * Stories for the macro viewer HEADER (.viewer-edge-top in GenericViewer.vue):
 * the title area (title, EMBED chip, READ-ONLY recovered chip) and the
 * top-right action row (Edit, View Source, the "Copy for AI ▾" split
 * button + its five-job menu, Fullscreen).
 *
 * GenericViewer is mounted for real (not a structural facsimile) — same
 * approach as Header.stories.ts — because the header's interactive bits
 * (the split button's inline state machine, CopyForAiMenu's popover) are
 * exactly what these stories exist to showcase. The two runtime dependencies
 * that would otherwise hit the network (globals.apWrapper.getCurrentPage /
 * canUserEdit) are shadowed directly on the singleton instance, mirroring
 * GenericViewer.spec.ts's vi.mock('@/model/globals', …) — Storybook has no
 * vi.mock, so the instance methods are reassigned instead (same technique
 * UpgradePrompt.stories.ts / GetStarted.stories.ts use for forgeGlobal
 * fields).
 *
 * All per-story environment setup goes through ONE decorator that calls
 * configureStory() below — deliberately NOT split across a shared
 * meta-level decorator plus a per-story one. @storybook/vue3-vite 10.4 runs
 * story-level decorators BEFORE the component (meta) ones (verified live:
 * with the setup split that way, a story's own installClipboardMock(false)
 * was silently overwritten back to `true` by the meta decorator running
 * after it). Consolidating into one decorator per story removes the ordering
 * dependency entirely.
 */

type Story = StoryObj<typeof GenericViewer>

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const SAMPLE_MERMAID =
  'sequenceDiagram\n  participant Client\n  participant Server\n  Client->>Server: POST /login\n  Server-->>Client: 200 OK'
const SAMPLE_SEQUENCE = 'Client->Server: POST /login\nServer-->Client: 200 OK'
const SAMPLE_PAGE = {
  title: 'Login flow — architecture notes',
  body: { export_view: { value: '<p>Context for the AI: this page documents the login handshake.</p>' } },
  _links: { base: 'https://example-tenant.atlassian.net/wiki', webui: '/spaces/DOCS/pages/123456' },
}
const ARCHITECTURE_TOKENS_RESPONSE = {
  indexedAt: '2026-08-27T00:00:00.000Z',
  contentVersion: 3,
  participants: [
    {
      actorId: 'Client',
      rawLabel: 'Client',
      related: [
        {
          contentId: 'related-101',
          pageId: 'page-101',
          pageTitle: 'Authentication overview',
          spaceKey: 'DOCS',
          rawLabelThere: 'Web Client',
        },
      ],
    },
    { actorId: 'Server', rawLabel: 'Server', related: [] },
  ],
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** No real Forge bridge — same shape Header.stories.ts / GetStarted.stories.ts use. */
function stubForge(moduleKey?: string, architectureTokensEnabled = false, customContentId?: string) {
  forgeGlobal.isForge = architectureTokensEnabled
  forgeGlobal.isLite = true
  forgeGlobal.zenumlRemoteBaseUrl = 'https://storybook.invalid'
  forgeGlobal.forgeContext = {
    accountId: 'storybook-user',
    // isEmbedded (GenericViewer.vue) reads forgeContext.moduleKey directly —
    // set only by the Embedded story below.
    moduleKey,
    extension: {
      content: { id: 'storybook-page' },
      space: { key: 'DOCS' },
      config: { customContentId },
    },
  }
}

function stubFeatureFlags(architectureTokensEnabled: boolean) {
  resetAiTitleFlagForTests()
  FeatureFlags.prototype.checkFlag = function (key: string, defaultValue = false) {
    return key === 'architecture-tokens-enabled' ? architectureTokensEnabled : defaultValue
  }
}

/**
 * copyForAi()'s page-context lookup (resolveCopyForAiPage) calls
 * globals.apWrapper.getCurrentPage() directly — the exact call
 * GenericViewer.spec.ts mocks via vi.mock('@/model/globals', …). Storybook
 * has no vi.mock, so shadow the instance method on the singleton instead.
 * `delayMs` lets the CopyCopying story hold the button in its transient
 * state, matching GenericViewer.spec.ts's "pending promise" technique for
 * that same assertion.
 */
function stubApWrapper({ delayMs = 0 }: { delayMs?: number } = {}) {
  globals.apWrapper.canUserEdit = async () => true
  globals.apWrapper.initializeContext = async () => undefined
  globals.apWrapper.getCurrentPage = async () => {
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
    return SAMPLE_PAGE
  }
}

/**
 * copyForAi() fires trackAnalyticsEvent('copy_for_ai_clicked', …) on every
 * outcome — real production behavior these stories don't want to fake away.
 * But .storybook/main.ts defines VITE_MIXPANEL_TOKEN as '' (no real project),
 * and mixpanel-browser's init()/register() throw internally against an empty
 * token (verified live: "Cannot read properties of undefined (reading
 * 'before_register')"). trackAnalyticsEvent already catches that (analytics
 * failures must never break the UI — see its outer try/catch), so the button
 * still reaches 'copied'/'failed' correctly either way; this just keeps the
 * story's console clean by no-op'ing the calls instead of letting them throw
 * into a caught-and-logged error every time.
 */
function stubMixpanel() {
  const noop = () => {}
  ;(mixpanel as any).init = noop
  ;(mixpanel as any).register = noop
  ;(mixpanel as any).track = noop
}

/**
 * copyToClipboard() (GenericViewer.vue) falls through to the legacy
 * document.execCommand('copy') textarea trick whenever the modern
 * clipboard.writeText() throws — and a real browser's execCommand('copy')
 * from a genuine click event normally SUCCEEDS, silently masking the
 * intended failure (verified live: rejecting only writeText still landed on
 * 'copied'). GenericViewer.spec.ts's own failure test stubs both for the
 * same reason — mirrored here.
 */
function installClipboardMock(shouldCopy: boolean) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: shouldCopy
      ? { writeText: async () => undefined }
      : {
          writeText: async () => {
            throw new Error('Storybook clipboard failure')
          },
        },
  })
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
  ;(document as any).execCommand = shouldCopy
    ? () => true
    : () => {
        throw new Error('Storybook execCommand unavailable')
      }
}

function setupStore({
  diagramType = DiagramType.Mermaid,
  title = 'Login flow',
  code = '',
  mermaidCode = SAMPLE_MERMAID,
  plantUmlCode = '',
  source = DataSource.CustomContent,
  id = 'cc-778899',
  isCopy = false,
  recoveredFromOrphan = false,
  snapshotFallback = false,
}: {
  diagramType?: DiagramType
  title?: string
  code?: string
  mermaidCode?: string
  plantUmlCode?: string
  source?: DataSource
  id?: string
  isCopy?: boolean
  recoveredFromOrphan?: boolean
  snapshotFallback?: boolean
} = {}) {
  store.commit('updateDiagramType', diagramType)
  store.commit('updateCode2', code)
  store.commit('updateMermaidCode', mermaidCode)
  store.commit('updatePlantUmlCode', plantUmlCode)
  store.commit('updateTitle', title)
  const diagram = (store.state as any).diagram
  diagram.source = source
  diagram.id = id
  diagram.isCopy = isCopy
  diagram.recoveredFromOrphan = recoveredFromOrphan
  diagram.snapshotFallback = snapshotFallback
  diagram.snapshotAt = undefined
}

/**
 * Single entry point every story's decorator calls — resets every global
 * this file touches, then applies the diagram fixture. Keeping this as one
 * function (rather than a shared meta-decorator + per-story decorator) means
 * there is only ever one order of operations to reason about; see the
 * file-header comment for why that matters here.
 */
function configureStory(options: {
  diagramType?: DiagramType
  title?: string
  code?: string
  mermaidCode?: string
  plantUmlCode?: string
  source?: DataSource
  id?: string
  isCopy?: boolean
  recoveredFromOrphan?: boolean
  snapshotFallback?: boolean
  moduleKey?: string
  clipboardWrites?: boolean
  pageFetchDelayMs?: number
  fullscreenMode?: boolean
  architectureTokensEnabled?: boolean
  customContentId?: string
} = {}) {
  resetStubResponses()
  stubFeatureFlags(Boolean(options.architectureTokensEnabled))
  stubForge(options.moduleKey, Boolean(options.architectureTokensEnabled), options.customContentId)
  if (options.architectureTokensEnabled) {
    stubResponses.remote = [
      { match: '/api/architecture-tokens/related', body: ARCHITECTURE_TOKENS_RESPONSE },
      { match: '/api/diagram-impact', body: { audienceCount: 3, viewerRelation: 'viewer' } },
    ]
  }
  if (options.fullscreenMode) {
    // isFullscreenMode reads window.forgeGlobal.forgeContext.extension.modal
    // (same object as the imported forgeGlobal — forgeGlobal.ts:229).
    ;(forgeGlobal.forgeContext as any).extension.modal = { macroMode: 'fullscreen' }
  }
  stubApWrapper({ delayMs: options.pageFetchDelayMs })
  stubMixpanel()
  installClipboardMock(options.clipboardWrites ?? true)
  setupStore(options)
  store.commit('setDiagramAttribution', null)
}

/**
 * The top-right action row (Edit/Source/Copy for AI/Fullscreen) is
 * hover-revealed: `.viewer-top-actions { opacity: 0 }` until the surface
 * gets `.viewer-surface--hover` on mouseenter (GenericViewer.vue's
 * `isHovering` — the same behavior GenericViewer.spec.ts exercises via
 * `surface.trigger('mouseenter')`). Every story below hovers first so the
 * row is actually visible for both the play-function assertions and anyone
 * browsing the story in Storybook.
 */
async function revealHeader() {
  const surface = document.querySelector<HTMLElement>('.viewer-surface')
  if (!surface) return
  await userEvent.hover(surface)
  // userEvent.hover() resolves once the pointer events are dispatched, but
  // Vue's isHovering->class reactivity (and the 200ms opacity transition)
  // hasn't necessarily flushed yet — wait for the actual computed style so
  // later toBeVisible() assertions don't race it (verified live: without
  // this, `view-source-btn` intermittently read opacity 0 right after hover).
  await waitFor(() => {
    const actions = document.querySelector<HTMLElement>('.viewer-top-actions')
    if (!actions || getComputedStyle(actions).opacity !== '1') {
      throw new Error('header actions not yet revealed')
    }
  })
}

/** Renders GenericViewer with a lightweight placeholder in the diagram slot. */
function renderViewer(args: Args, placeholderLabel = 'Diagram preview') {
  return {
    components: { GenericViewer },
    setup() {
      return { args, placeholderLabel }
    },
    template: `
      <GenericViewer v-bind="args">
        <div style="padding: 64px 24px; text-align: center; color: #6B7280; font-size: 13px;">
          {{ placeholderLabel }}
        </div>
      </GenericViewer>
    `,
  }
}

/** Production integration: GenericViewer with the real Mermaid renderer in its slot. */
function renderMermaidViewer(args: Args) {
  return {
    components: { GenericViewer, Mermaid },
    setup() {
      return { args }
    },
    template: `
      <GenericViewer v-bind="args">
        <Mermaid />
      </GenericViewer>
    `,
  }
}

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

const meta: Meta<typeof GenericViewer> = {
  title: 'Viewer/GenericViewer — macro header',
  component: GenericViewer,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The macro viewer header (.viewer-edge-top row): the title area (title, EMBED chip, ' +
          'READ-ONLY recovered chip) and the top-right action row — Edit, View Source, the ' +
          '"Copy for AI ▾" split button (one-click generic copy + a chevron menu of five ' +
          'job-framed entries, with inline Copying…/Copied/Copy failed feedback), and Fullscreen.',
      },
    },
  },
}

export default meta

// ---------------------------------------------------------------------------
// 1. Default — idle header (mermaid diagram)
// ---------------------------------------------------------------------------

/**
 * A text-DSL diagram (Mermaid) with an ordinary edit permission and no
 * recovery/embed state: Edit, Source, "Copy for AI ▾" (idle), and Fullscreen
 * are all visible in the top-right action row.
 */
export const Default: Story = {
  name: 'Default — idle header',
  decorators: [
    () => {
      configureStory({ diagramType: DiagramType.Mermaid, title: 'Login flow', mermaidCode: SAMPLE_MERMAID })
      return { template: '<story />' }
    },
  ],
  render: (args: Args) => renderViewer(args, 'Mermaid diagram preview'),
  play: async () => {
    await revealHeader()
    const canvas = within(document.body)
    await expect(canvas.getByRole('button', { name: 'Edit' })).toBeEnabled()
    await expect(await canvas.findByTestId('view-source-btn')).toBeVisible()
    const copyBtn = await canvas.findByTestId('copy-for-ai-btn')
    await expect(copyBtn).toHaveAttribute('data-copy-state', 'idle')
    await expect(canvas.getByRole('button', { name: 'Fullscreen' })).toBeVisible()
  },
}

/**
 * Architecture Tokens Phase 1 through its real production seam: the flag is
 * resolved by the Storybook @forge/bridge FeatureFlags stub, GenericViewer
 * mounts RelatedDiagramsFooter, and Mermaid.vue produces the actor rectangles
 * the overlay listens to. All fixture vocabulary is invented.
 */
export const ArchitectureTokensMermaidIntegration: Story = {
  name: 'Architecture tokens — real Mermaid integration',
  loaders: [
    async () => {
      __resetMermaidLoaderForTests()
      const bundledMermaid = await import('mermaid')
      await loadMermaid({ importer: async () => bundledMermaid, retries: 0 })
      return {}
    },
  ],
  decorators: [
    () => {
      configureStory({
        diagramType: DiagramType.Mermaid,
        title: 'Login flow',
        mermaidCode: SAMPLE_MERMAID,
        architectureTokensEnabled: true,
        customContentId: 'storybook-content-778899',
      })
      store.state.viewerLoadState = 'ready'
      store.commit('setDiagramAttribution', {
        customContentId: 'storybook-content-778899',
      })
      return { template: '<story />' }
    },
  ],
  render: (args: Args) => renderMermaidViewer(args),
  play: async () => {
    const canvas = within(document.body)
    await expect(await canvas.findByTestId('related-diagrams-footer')).toHaveTextContent(
      '1 of 2 participants also appear in other diagrams you can access',
    )
    await expect(await canvas.findByTestId('diagram-attribution')).toHaveTextContent('3 views')

    let actor: SVGRectElement | null = null
    await waitFor(() => {
      actor = document.querySelector<SVGRectElement>('rect.actor-top[name="Client"]')
      if (!actor) throw new Error('real Mermaid actor rectangle not rendered')
    })
    await userEvent.hover(actor!)

    const pill = await canvas.findByTestId('related-diagrams-pill')
    await waitFor(() => expect(pill).not.toHaveClass('related-diagrams-pill--concealed'))
    await expect(pill).toHaveTextContent('1')
    await userEvent.click(pill)

    const popover = await canvas.findByTestId('related-diagrams-popover')
    await expect(popover).toBeVisible()
    await expect(popover).toHaveTextContent('Possibly related by name')
    await expect(popover).toHaveTextContent('Authentication overview')
  },
}

// ---------------------------------------------------------------------------
// 2. CopyStates — the four inline states of the Copy for AI primary segment
// ---------------------------------------------------------------------------
// Each story drives the SAME real click → copyForAi() flow the button uses in
// production (not a forced internal-data shortcut) so the states shown are
// exactly what a user would see. 'idle' needs no interaction; 'copying' holds
// on a page-fetch promise that never resolves (mirrors the spec's pending-
// promise technique); 'copied' and 'failed' let the real flow settle and
// assert on the terminal label + data-copy-state before the ~2s auto-revert.

/** Idle — the split button before any interaction. */
export const CopyStateIdle: Story = {
  name: 'CopyStates — idle',
  decorators: [
    () => {
      configureStory({ diagramType: DiagramType.Sequence, title: 'Login flow', code: SAMPLE_SEQUENCE })
      return { template: '<story />' }
    },
  ],
  render: (args: Args) => renderViewer(args),
  play: async () => {
    await revealHeader()
    const canvas = within(document.body)
    const btn = await canvas.findByTestId('copy-for-ai-btn')
    await expect(btn).toHaveAttribute('data-copy-state', 'idle')
    await expect(btn.querySelector('[data-active="true"]')).toHaveTextContent('Copy for AI')
  },
}

/** Copying — the page-context fetch is deliberately held open. */
export const CopyStateCopying: Story = {
  name: 'CopyStates — copying',
  decorators: [
    () => {
      // pageFetchDelayMs never resolves within the story's lifetime — holds
      // the button in 'copying' for the static demo, same shape as the
      // spec's pending promise for this exact assertion.
      configureStory({
        diagramType: DiagramType.Sequence,
        title: 'Login flow',
        code: SAMPLE_SEQUENCE,
        pageFetchDelayMs: 24 * 60 * 60 * 1000,
      })
      return { template: '<story />' }
    },
  ],
  render: (args: Args) => renderViewer(args),
  play: async () => {
    await revealHeader()
    const canvas = within(document.body)
    const btn = await canvas.findByTestId('copy-for-ai-btn')
    await userEvent.click(btn)
    await waitFor(() => expect(btn).toHaveAttribute('data-copy-state', 'copying'))
    await expect(btn).toHaveAttribute('aria-busy', 'true')
    await expect(btn).toBeDisabled()
    await expect(btn.querySelector('[data-active="true"]')).toHaveTextContent('Copying…')
  },
}

/** Copied — clipboard write succeeds. */
export const CopyStateCopied: Story = {
  name: 'CopyStates — copied',
  decorators: [
    () => {
      configureStory({ diagramType: DiagramType.Sequence, title: 'Login flow', code: SAMPLE_SEQUENCE })
      return { template: '<story />' }
    },
  ],
  render: (args: Args) => renderViewer(args),
  play: async () => {
    await revealHeader()
    const canvas = within(document.body)
    const btn = await canvas.findByTestId('copy-for-ai-btn')
    await userEvent.click(btn)
    await waitFor(() => expect(btn).toHaveAttribute('data-copy-state', 'copied'))
    await expect(btn.querySelector('[data-active="true"]')).toHaveTextContent('Copied')
    await expect(await canvas.findByTestId('copy-for-ai-announcement')).toHaveTextContent('Copied')
  },
}

/** Copy failed — clipboard.writeText rejects. */
export const CopyStateFailed: Story = {
  name: 'CopyStates — copy failed',
  decorators: [
    () => {
      configureStory({
        diagramType: DiagramType.Sequence,
        title: 'Login flow',
        code: SAMPLE_SEQUENCE,
        clipboardWrites: false,
      })
      return { template: '<story />' }
    },
  ],
  render: (args: Args) => renderViewer(args),
  play: async () => {
    await revealHeader()
    const canvas = within(document.body)
    const btn = await canvas.findByTestId('copy-for-ai-btn')
    await userEvent.click(btn)
    await waitFor(() => expect(btn).toHaveAttribute('data-copy-state', 'failed'))
    await expect(btn.querySelector('[data-active="true"]')).toHaveTextContent('Copy failed')
  },
}

// ---------------------------------------------------------------------------
// 3. JobMenuOpen — the chevron's five-entry job menu
// ---------------------------------------------------------------------------

/**
 * Clicks the chevron segment to open CopyForAiMenu's popover, showing all
 * five job-framed entries with their description lines.
 */
export const JobMenuOpen: Story = {
  name: 'JobMenuOpen — five job entries',
  decorators: [
    () => {
      configureStory({ diagramType: DiagramType.Sequence, title: 'Login flow', code: SAMPLE_SEQUENCE })
      return { template: '<story />' }
    },
  ],
  render: (args: Args) => renderViewer(args),
  play: async () => {
    await revealHeader()
    const canvas = within(document.body)
    const menuBtn = await canvas.findByTestId('copy-for-ai-menu-btn')
    await userEvent.click(menuBtn)

    await expect(await canvas.findByTestId('copy-for-ai-job-explain')).toHaveTextContent('Ask about this flow')
    await expect(canvas.getByTestId('copy-for-ai-job-explain')).toHaveTextContent('Get answers from the diagram and its page')
    await expect(canvas.getByTestId('copy-for-ai-job-update')).toHaveTextContent('Update this diagram')
    await expect(canvas.getByTestId('copy-for-ai-job-update')).toHaveTextContent('Describe a change, get paste-ready source back')
    await expect(canvas.getByTestId('copy-for-ai-job-implement')).toHaveTextContent('Implement this design')
    await expect(canvas.getByTestId('copy-for-ai-job-implement')).toHaveTextContent('Take the spec into your coding agent')
    await expect(canvas.getByTestId('copy-for-ai-job-audit')).toHaveTextContent('Check against my codebase')
    await expect(canvas.getByTestId('copy-for-ai-job-audit')).toHaveTextContent('Find where diagram and code disagree')
    await expect(canvas.getByTestId('copy-for-ai-job-tests')).toHaveTextContent('Generate test cases')
    await expect(canvas.getByTestId('copy-for-ai-job-tests')).toHaveTextContent('Derive tests from this flow')
  },
}

// ---------------------------------------------------------------------------
// 4. GraphType — non-text-DSL diagram: no Source, no Copy for AI
// ---------------------------------------------------------------------------

/**
 * A Graph (DrawIO) diagram. View Source and Copy for AI are text-DSL-only
 * (showViewSource) so both are absent; Edit and Fullscreen stay present.
 */
export const GraphType: Story = {
  name: 'GraphType — no Source / Copy for AI',
  decorators: [
    () => {
      configureStory({ diagramType: DiagramType.Graph, title: 'Deployment topology' })
      return { template: '<story />' }
    },
  ],
  render: (args: Args) => renderViewer(args, 'Graph (DrawIO) preview'),
  play: async () => {
    await revealHeader()
    const canvas = within(document.body)
    await expect(canvas.getByRole('button', { name: 'Edit' })).toBeEnabled()
    await expect(canvas.queryByTestId('view-source-btn')).toBeNull()
    await expect(canvas.queryByTestId('copy-for-ai-btn')).toBeNull()
    await expect(canvas.getByRole('button', { name: 'Fullscreen' })).toBeVisible()
  },
}

// ---------------------------------------------------------------------------
// 5. RecoveredReadOnly — orphan-recovered diagram
// ---------------------------------------------------------------------------

/**
 * diagram.recoveredFromOrphan = true (ZEN-1170 Defect 2b): the READ-ONLY
 * chip appears next to the title, the recovery banner explains how to save
 * changes, and Edit is disabled (title carries the steer-to-page-editor copy).
 */
export const RecoveredReadOnly: Story = {
  name: 'RecoveredReadOnly — READ-ONLY chip + banner',
  decorators: [
    () => {
      configureStory({
        diagramType: DiagramType.Sequence,
        title: 'Login flow',
        code: SAMPLE_SEQUENCE,
        recoveredFromOrphan: true,
      })
      return { template: '<story />' }
    },
  ],
  render: (args: Args) => renderViewer(args),
  play: async () => {
    await revealHeader()
    const canvas = within(document.body)
    await expect(canvas.getByText('READ-ONLY')).toBeVisible()
    await expect(await canvas.findByTestId('recovered-banner')).toHaveTextContent('Recovered from backup.')
    const editBtn = canvas.getByRole('button', { name: 'Edit' })
    await expect(editBtn).toBeDisabled()
    await expect(editBtn).toHaveAttribute(
      'title',
      'This diagram was recovered from a backup. To save changes, click Edit on the page (top right), then click Edit on this macro.',
    )
  },
}

// ---------------------------------------------------------------------------
// 6. Embedded — EMBED chip
// ---------------------------------------------------------------------------

/**
 * Rendered from an embed macro (isEmbedded, driven by forgeContext.moduleKey
 * matching /embed-macro/): the EMBED chip appears in the title area.
 */
export const Embedded: Story = {
  name: 'Embedded — EMBED chip',
  decorators: [
    () => {
      configureStory({
        diagramType: DiagramType.Mermaid,
        title: 'Login flow (embedded)',
        mermaidCode: SAMPLE_MERMAID,
        moduleKey: 'zenuml-embed-macro',
      })
      return { template: '<story />' }
    },
  ],
  render: (args: Args) => renderViewer(args),
  play: async () => {
    await revealHeader()
    const canvas = within(document.body)
    await expect(canvas.getByText('EMBED')).toBeVisible()
  },
}

// ---------------------------------------------------------------------------
// 7. View Source panel — inline vs fullscreen (fix/viewsource-fullscreen-fit)
// ---------------------------------------------------------------------------

/** Inline surface: panel keeps the original 300px right-sheet layout. */
export const SourcePanelInline: Story = {
  name: 'Source panel — inline',
  decorators: [
    () => {
      configureStory({ diagramType: DiagramType.Mermaid, title: 'Login flow', mermaidCode: SAMPLE_MERMAID })
      return { template: '<story />' }
    },
  ],
  render: (args: Args) => renderViewer(args, 'Mermaid diagram preview'),
  play: async () => {
    await revealHeader()
    const canvas = within(document.body)
    await userEvent.click(await canvas.findByTestId('view-source-btn'))
    await waitFor(() => {
      const panel = document.querySelector('.view-source-panel')
      if (!panel) throw new Error('panel not open')
      if (panel.classList.contains('view-source-panel--fullscreen')) {
        throw new Error('inline surface must not get the fullscreen class')
      }
    })
  },
}

/** Fullscreen surface: panel is viewport-anchored and widened (the fix). */
export const SourcePanelFullscreen: Story = {
  name: 'Source panel — fullscreen',
  decorators: [
    () => {
      configureStory({
        diagramType: DiagramType.Mermaid,
        title: 'Login flow',
        mermaidCode: SAMPLE_MERMAID,
        fullscreenMode: true,
      })
      return { template: '<story />' }
    },
  ],
  render: (args: Args) => renderViewer(args, 'Mermaid diagram preview'),
  play: async () => {
    await revealHeader()
    const canvas = within(document.body)
    await userEvent.click(await canvas.findByTestId('view-source-btn'))
    await waitFor(() => {
      const panel = document.querySelector('.view-source-panel')
      if (!panel || !panel.classList.contains('view-source-panel--fullscreen')) {
        throw new Error('fullscreen surface must get the fullscreen class')
      }
    })
  },
}

// ---------------------------------------------------------------------------
// 9. Load-failed recovery panel — retryable vs terminal
// ---------------------------------------------------------------------------
// store.state.viewerLoadState isn't part of the `diagram` object setupStore()
// configures, so it's set directly here after configureStory() runs.

export const LoadFailedWithSource: Story = {
  name: 'Load failed — retryable (has a source id)',
  decorators: [
    () => {
      configureStory({ diagramType: DiagramType.Mermaid, title: 'Login flow' })
      store.state.viewerLoadState = 'failed_with_source'
      store.state.loadError = { httpStatus: 404, directFetchStatus: 'not_found' }
      return { template: '<story />' }
    },
  ],
  render: (args: Args) => renderViewer(args),
  play: async () => {
    const canvas = within(document.body)
    await expect(await canvas.findByText("This diagram isn't available")).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Try again' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Contact support' })).toBeVisible()
  },
}

export const LoadFailedWithoutSource: Story = {
  name: 'Load failed — terminal (no source id)',
  decorators: [
    () => {
      configureStory({ diagramType: DiagramType.Mermaid, title: 'Login flow' })
      store.state.viewerLoadState = 'failed_without_source'
      store.state.loadError = null
      return { template: '<story />' }
    },
  ],
  render: (args: Args) => renderViewer(args),
  play: async () => {
    const canvas = within(document.body)
    await expect(await canvas.findByText('The diagram data is no longer available')).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
    await expect(canvas.getByRole('button', { name: 'Contact support' })).toBeVisible()
  },
}
