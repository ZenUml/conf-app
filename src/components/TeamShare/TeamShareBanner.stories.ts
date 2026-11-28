import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { expect, userEvent, within } from 'storybook/test'
import TeamShareBanner from './TeamShareBanner.vue'

type Story = StoryObj<typeof TeamShareBanner>

const PREVIEW = {
  pageTitle: 'Checkout service design',
  pageUrl: 'https://example-tenant.atlassian.net/wiki/spaces/ENG/pages/123/Checkout+service+design',
  diagramTitle: 'Checkout flow',
}

const meta: Meta<typeof TeamShareBanner> = {
  title: 'Page banner/TeamShareBanner',
  component: TeamShareBanner,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Page-banner strip shown once after a first diagram on a small Lite/Full site. ' +
          'Copy message / Copy link / Not now. Stories use the `preview` prop, which skips ' +
          'the gate, the Confluence requests and analytics. view.close() is a no-op in Storybook.',
      },
    },
  },
  args: { preview: PREVIEW },
}

export default meta

/** Default: a titled diagram. */
export const Default: Story = {
  play: async () => {
    const canvas = within(document.body)
    await expect(
      await canvas.findByText('Nice — "Checkout flow" is on this page. Share it with your team?'),
    ).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Copy message' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Copy link' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Not now' })).toBeVisible()
  },
}

/**
 * Storybook's iframe denies the async Clipboard API, which would send the copy
 * stories down the manual fallback. Stub a working clipboard for them.
 */
function workingClipboard() {
  const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async () => {} },
  })
  return () => {
    if (original) Object.defineProperty(navigator, 'clipboard', original)
    else delete (navigator as any).clipboard
  }
}

/** After Copy message: green "Copied ✓" and the paste hint. */
export const CopiedMessage: Story = {
  beforeEach: workingClipboard,
  play: async () => {
    const canvas = within(document.body)
    await userEvent.click(await canvas.findByRole('button', { name: 'Copy message' }))
    await expect(await canvas.findByRole('button', { name: 'Copied ✓' })).toBeVisible()
    await expect(canvas.getByText('Paste it in Slack, Teams or email.')).toBeVisible()
  },
}

/** After Copy link. */
export const CopiedLink: Story = {
  beforeEach: workingClipboard,
  play: async () => {
    const canvas = within(document.body)
    await userEvent.click(await canvas.findByRole('button', { name: 'Copy link' }))
    await expect(await canvas.findByRole('button', { name: 'Link copied ✓' })).toBeVisible()
  },
}

/** No usable diagram title: the headline names the diagram type instead. */
export const NoTitle: Story = {
  args: { preview: { ...PREVIEW, diagramTitle: 'Untitled 2026-11-28T00:00:00.000Z', diagramType: 'mermaid' } },
  play: async () => {
    const canvas = within(document.body)
    await expect(
      await canvas.findByText('Nice — your Mermaid diagram is on this page. Share it with your team?'),
    ).toBeVisible()
  },
}

/** Both clipboard paths fail: the message is shown for a manual copy. */
export const ManualCopyFallback: Story = {
  beforeEach: () => {
    const clip = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    const exec = document.execCommand
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async () => { throw new Error('denied') } },
    })
    document.execCommand = () => false
    return () => {
      if (clip) Object.defineProperty(navigator, 'clipboard', clip)
      else delete (navigator as any).clipboard
      document.execCommand = exec
    }
  },
  play: async () => {
    const canvas = within(document.body)
    await userEvent.click(await canvas.findByRole('button', { name: 'Copy message' }))
    await expect(await canvas.findByText('Press Ctrl/Cmd+C to copy')).toBeVisible()
  },
}
