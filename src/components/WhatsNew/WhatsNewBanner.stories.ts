import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { expect, userEvent, within } from 'storybook/test'
import WhatsNewBanner from './WhatsNewBanner.vue'
import forgeGlobal from '@/model/globals/forgeGlobal'
import type { WhatsNewRelease } from '@/utils/whatsNew/releases'

type Story = StoryObj<typeof WhatsNewBanner>

/** Sample copy for the story only — real releases live in utils/whatsNew/releases.ts. */
const SAMPLE: WhatsNewRelease = {
  id: 'storybook',
  publishedAt: '2026-10-01',
  headline: 'Faster rendering and a new export option',
  items: [
    { id: 'render', title: 'Faster rendering', body: 'Diagrams on long pages now appear sooner.' },
    {
      id: 'export',
      title: 'Export to PNG',
      body: 'Download any diagram as an image from Fullscreen.',
      url: 'https://zenuml.com',
    },
  ],
}

/**
 * No page id in the context, so the component skips the unplaced-property read
 * (which would otherwise hit Confluence REST and, failing, yield the slot).
 */
function installMocks() {
  localStorage.setItem('mockClientDomain', 'example-tenant')
  localStorage.removeItem('whatsNewBanner:example-tenant')
  forgeGlobal.isForge = false
  forgeGlobal.forgeContext = { accountId: 'storybook-user', extension: {} }
}

const meta: Meta<typeof WhatsNewBanner> = {
  title: 'Page banner/WhatsNewBanner',
  component: WhatsNewBanner,
  tags: ['autodocs'],
  args: { release: SAMPLE },
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          "Release notes as an inline page-banner strip: a one-line headline with \"See what's new\" " +
          'that expands the item list in place. Dismiss retires the release for this browser. ' +
          'Lowest priority in the page-banner host.',
      },
    },
  },
  decorators: [
    () => {
      installMocks()
      return { template: '<story />' }
    },
  ],
}

export default meta

export const Collapsed: Story = {
  name: 'Collapsed — headline only',
  play: async () => {
    const canvas = within(document.body)
    await expect(await canvas.findByText(/Faster rendering and a new export option/)).toBeVisible()
    await expect(canvas.queryByText(/Download any diagram/)).toBeNull()
  },
}

export const Expanded: Story = {
  name: 'Expanded — item list visible',
  play: async () => {
    const canvas = within(document.body)
    await userEvent.click(await canvas.findByRole('button', { name: /See what's new/ }))
    await expect(canvas.getByText(/Download any diagram/)).toBeVisible()
    await expect(canvas.getByRole('button', { name: /Learn more/ })).toBeVisible()
  },
}
