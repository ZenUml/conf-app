import type { Meta, StoryObj } from '@storybook/vue3-vite'
import DiagramAttributionFooter from './DiagramAttributionFooter.vue'
import { resetStubResponses, stubResponses } from '@/stubs/forge-bridge'

/**
 * The attribution footer under a rendered diagram (`data-testid="diagram-attribution"`).
 *
 * The component resolves display names through `forgeRequest` and the audience
 * count through `callRemote`, both of which reach `@forge/bridge`. Storybook
 * aliases that specifier to `src/stubs/forge-bridge.ts` (see `.storybook/main.ts`),
 * so each story fills `stubResponses` in its own decorator rather than mocking
 * modules — Storybook has no `vi.mock`. `resetStubResponses()` runs first so a
 * story never inherits the previous one's data.
 *
 * `ready` gates only the 3-second view-registration timer, not the render, so
 * these stories leave it false and no `diagram-impact/view` write is attempted.
 *
 * Note what the footer does NOT render: with `attribution` set but no resolvable
 * name and no audience count, the element still exists but is empty. The
 * "Created by" line requires BOTH an account id and a name the user lookup
 * resolved.
 */
const CREATOR = 'acct-creator'
const UPDATER = 'acct-updater'

function withStubs(users: Record<string, { displayName: string }>, audienceCount?: number) {
  return () => {
    resetStubResponses()
    stubResponses.users = users
    if (audienceCount !== undefined) {
      stubResponses.remote = [
        { match: '/api/diagram-impact', body: { audienceCount, viewerRelation: 'viewer' } },
      ]
    }
    return { template: '<div style="padding:24px"><story/></div>' }
  }
}

const meta: Meta<typeof DiagramAttributionFooter> = {
  title: 'Viewer/DiagramAttributionFooter',
  component: DiagramAttributionFooter,
  parameters: { layout: 'centered' },
}
export default meta

type Story = StoryObj<typeof DiagramAttributionFooter>

/** The common case: one author, no separate editor, no audience data yet. */
export const CreatedOnly: Story = {
  decorators: [withStubs({ [CREATOR]: { displayName: 'Robot Yanhui' } })],
  args: {
    attribution: { customContentId: '93093905', createdByAccountId: CREATOR },
    macroType: 'sequence',
    ready: false,
  },
}

/** A different person last edited the diagram, so both names show. */
export const CreatedAndUpdated: Story = {
  decorators: [
    withStubs({
      [CREATOR]: { displayName: 'Robot Yanhui' },
      [UPDATER]: { displayName: 'Peng Xiao' },
    }),
  ],
  args: {
    attribution: {
      customContentId: '93093905',
      createdByAccountId: CREATOR,
      lastUpdatedByAccountId: UPDATER,
    },
    macroType: 'sequence',
    ready: false,
  },
}

/**
 * Creator and last updater are the same account. The template suppresses the
 * duplicate "Last updated by" clause.
 */
export const SameAuthorAndUpdater: Story = {
  decorators: [withStubs({ [CREATOR]: { displayName: 'Robot Yanhui' } })],
  args: {
    attribution: {
      customContentId: '93093905',
      createdByAccountId: CREATOR,
      lastUpdatedByAccountId: CREATOR,
    },
    macroType: 'sequence',
    ready: false,
  },
}

/** With the diagram-impact backend answering, the audience count is appended. */
export const WithAudienceCount: Story = {
  decorators: [
    withStubs(
      {
        [CREATOR]: { displayName: 'Robot Yanhui' },
        [UPDATER]: { displayName: 'Peng Xiao' },
      },
      7,
    ),
  ],
  args: {
    attribution: {
      customContentId: '93093905',
      createdByAccountId: CREATOR,
      lastUpdatedByAccountId: UPDATER,
    },
    macroType: 'sequence',
    ready: false,
  },
}

/** Exactly one viewer — the label is singular. */
export const SingleViewer: Story = {
  decorators: [withStubs({ [CREATOR]: { displayName: 'Robot Yanhui' } }, 1)],
  args: {
    attribution: { customContentId: '93093905', createdByAccountId: CREATOR },
    macroType: 'sequence',
    ready: false,
  },
}

/**
 * What a cached render produced before the `attribution` field was added to the
 * SWR cache entry (`src/utils/renderCache/contentCacheStore.ts`): the viewer
 * mounted with `attribution = null`, so `v-if` removed the footer entirely.
 * Nothing renders here — that is the defect, not a broken story.
 */
export const NoAttribution: Story = {
  decorators: [withStubs({})],
  args: { attribution: null, macroType: 'sequence', ready: false },
}
