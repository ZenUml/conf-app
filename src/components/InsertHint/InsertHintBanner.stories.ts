import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import InsertHintBanner from './InsertHintBanner.vue'

type Story = StoryObj<typeof InsertHintBanner>

const meta: Meta<typeof InsertHintBanner> = {
  title: 'Page banner/InsertHintBanner',
  component: InsertHintBanner,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'H.1 insert hint, design B (Figma "H.1 banner · detail design (2026-11-28)"). ' +
          'Tabs rotate once: Mermaid 3 s, draw.io 3 s, Swagger 3 s, back to Mermaid, stop. ' +
          'Hover pauses; a click or Arrow key stops the pass. With reduced motion there is no ' +
          'rotation and no build animation. The component emits shown, tab-change (source auto, ' +
          'click or keyboard), replay and dismiss; it sends no analytics itself.',
      },
    },
  },
  args: {
    onShown: fn(),
    'onTab-change': fn(),
    onReplay: fn(),
    onDismiss: fn(),
  },
}

export default meta

/** Live: rotates once through the three tabs, then rests on Mermaid. */
export const AutoRotate: Story = {}

/** B1: Mermaid at rest (no rotation). */
export const Mermaid: Story = {
  args: { autoRotate: false, initialTab: 'mermaid' },
  play: async () => {
    const canvas = within(document.body)
    await expect(await canvas.findByRole('tab', { name: /Mermaid/ })).toHaveAttribute('aria-selected', 'true')
    await expect(canvas.getByTestId('insert-hint-command')).toHaveTextContent('/mermaid')
  },
}

/** B2: draw.io at rest. */
export const Drawio: Story = {
  args: { autoRotate: false, initialTab: 'drawio' },
  play: async () => {
    const canvas = within(document.body)
    await expect(await canvas.findByRole('tab', { name: /draw\.io/ })).toHaveAttribute('aria-selected', 'true')
    await expect(canvas.getByTestId('insert-hint-command')).toHaveTextContent('/drawio')
    await expect(canvas.getByText('Cloud')).toBeInTheDocument()
  },
}

/** B3: Swagger at rest. */
export const Swagger: Story = {
  args: { autoRotate: false, initialTab: 'swagger' },
  play: async () => {
    const canvas = within(document.body)
    await expect(await canvas.findByRole('tab', { name: /Swagger/ })).toHaveAttribute('aria-selected', 'true')
    await expect(canvas.getByTestId('insert-hint-command')).toHaveTextContent('/swagger')
  },
}

/** Click a tab: rotation stops and the source is "click". */
export const ClickStopsRotation: Story = {
  play: async ({ args }) => {
    const canvas = within(document.body)
    await userEvent.click(await canvas.findByRole('tab', { name: /Swagger/ }))
    await expect(args['onTab-change']).toHaveBeenLastCalledWith({ tab: 'swagger', source: 'click' })
    await expect(canvas.getByTestId('insert-hint-progress')).toHaveStyle({ width: '100%' })
  },
}

/** B4: keyboard focus on the tab list; Arrow Down moves the selection. */
export const KeyboardFocus: Story = {
  args: { autoRotate: false },
  play: async ({ args }) => {
    const canvas = within(document.body)
    const first = await canvas.findByRole('tab', { name: /Mermaid/ })
    first.focus()
    await userEvent.keyboard('{ArrowDown}')
    await expect(canvas.getByRole('tab', { name: /draw\.io/ })).toHaveFocus()
    await expect(args['onTab-change']).toHaveBeenLastCalledWith({ tab: 'drawio', source: 'keyboard' })
  },
}

/** prefers-reduced-motion: no rotation, full Mermaid, full bar. */
export const ReducedMotion: Story = {
  args: { reducedMotion: true },
  play: async () => {
    const canvas = within(document.body)
    await expect(await canvas.findByRole('tab', { name: /Mermaid/ })).toHaveAttribute('aria-selected', 'true')
    await expect(canvas.getByTestId('insert-hint-progress')).toHaveStyle({ width: '100%' })
  },
}
