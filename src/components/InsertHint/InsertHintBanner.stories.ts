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
          'Tabs rotate once: Flowchart 3 s, Architecture 3 s, API docs 3 s, back to Flowchart, stop. ' +
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

/** Live: rotates once through the three tabs, then rests on Flowchart. */
export const AutoRotate: Story = {}

/** B1: Flowchart at rest (no rotation). */
export const Flowchart: Story = {
  args: { autoRotate: false, initialTab: 'flowchart' },
  play: async () => {
    const canvas = within(document.body)
    await expect(await canvas.findByRole('tab', { name: /Flowchart/ })).toHaveAttribute('aria-selected', 'true')
    await expect(canvas.getByTestId('insert-hint-command')).toHaveTextContent('/mermaid')
  },
}

/** B2: Architecture at rest. */
export const Architecture: Story = {
  args: { autoRotate: false, initialTab: 'architecture' },
  play: async () => {
    const canvas = within(document.body)
    await expect(await canvas.findByRole('tab', { name: /Architecture/ })).toHaveAttribute('aria-selected', 'true')
    await expect(canvas.getByTestId('insert-hint-command')).toHaveTextContent('/drawio')
    await expect(canvas.getByText('Cloud')).toBeInTheDocument()
  },
}

/** B3: API docs at rest. */
export const ApiDocs: Story = {
  args: { autoRotate: false, initialTab: 'api' },
  play: async () => {
    const canvas = within(document.body)
    await expect(await canvas.findByRole('tab', { name: /API docs/ })).toHaveAttribute('aria-selected', 'true')
    await expect(canvas.getByTestId('insert-hint-command')).toHaveTextContent('/swagger')
  },
}

/** Click a tab: rotation stops and the source is "click". */
export const ClickStopsRotation: Story = {
  play: async ({ args }) => {
    const canvas = within(document.body)
    await userEvent.click(await canvas.findByRole('tab', { name: /API docs/ }))
    await expect(args['onTab-change']).toHaveBeenLastCalledWith({ tab: 'api', source: 'click' })
    await expect(canvas.getByTestId('insert-hint-progress')).toHaveStyle({ width: '100%' })
  },
}

/** B4: keyboard focus on the tab list; Arrow Down moves the selection. */
export const KeyboardFocus: Story = {
  args: { autoRotate: false },
  play: async ({ args }) => {
    const canvas = within(document.body)
    const first = await canvas.findByRole('tab', { name: /Flowchart/ })
    first.focus()
    await userEvent.keyboard('{ArrowDown}')
    await expect(canvas.getByRole('tab', { name: /Architecture/ })).toHaveFocus()
    await expect(args['onTab-change']).toHaveBeenLastCalledWith({ tab: 'architecture', source: 'keyboard' })
  },
}

/** prefers-reduced-motion: no rotation, full Flowchart, full bar. */
export const ReducedMotion: Story = {
  args: { reducedMotion: true },
  play: async () => {
    const canvas = within(document.body)
    await expect(await canvas.findByRole('tab', { name: /Flowchart/ })).toHaveAttribute('aria-selected', 'true')
    await expect(canvas.getByTestId('insert-hint-progress')).toHaveStyle({ width: '100%' })
  },
}
