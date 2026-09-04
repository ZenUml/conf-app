import type { Meta, StoryObj } from '@storybook/vue3-vite'
import DrawIoHeader from './DrawIoHeader.vue'

const renderInDrawioRow = (args: Record<string, unknown>) => ({
  components: { DrawIoHeader },
  setup: () => ({ args }),
  template: `
    <div style="min-height: 280px; background: #fff; color: #42526e; font-family: system-ui, sans-serif;">
      <div style="position: relative; height: 44px; display: flex; align-items: center; border-bottom: 1px solid #dfe1e6; background: #f7f8f9; padding: 0 12px; box-sizing: border-box;">
        <div style="display: flex; gap: 16px; font-size: 12px; white-space: nowrap;"><span>File</span><span>Edit</span><span>View</span><span>Arrange</span><span>Extras</span><span>Help</span></div>
        <span style="flex: 1; min-width: 72px;"></span>
        <div style="display: flex; gap: 8px; align-items: center; font-size: 12px;"><button style="height: 28px; padding: 0 10px; border: 1px solid #c1c7d0; border-radius: 3px; background: #fff; color: #42526e;">Format</button><button style="height: 28px; padding: 0 10px; border: 0; border-radius: 3px; background: #0052cc; color: #fff;">Publish</button></div>
        <DrawIoHeader v-bind="args" />
      </div>
      <div style="height: 236px; background-image: linear-gradient(#edf0f2 1px, transparent 1px), linear-gradient(90deg, #edf0f2 1px, transparent 1px); background-size: 10px 10px;"></div>
    </div>
  `,
})

const meta: Meta<typeof DrawIoHeader> = {
  title: 'Layout/DrawIO editor chrome',
  component: DrawIoHeader,
  parameters: {
    layout: 'fullscreen',
    docs: { description: { component: 'Graph and Board title states. Board deliberately uses the 28px Sketch-row variant.' } },
  },
}

export default meta
type Story = StoryObj<typeof DrawIoHeader>

export const Graph: Story = {
  render: renderInDrawioRow,
  args: { title: 'Payment topology', editorMode: 'diagram' },
}

export const Board: Story = {
  render: renderInDrawioRow,
  args: { title: 'Workshop map', editorMode: 'board' },
}

export const EmptyBoard: Story = {
  render: renderInDrawioRow,
  args: { title: '', editorMode: 'board', aiTitleAvailable: true },
}

export const TitleError: Story = {
  render: renderInDrawioRow,
  args: { title: '', editorMode: 'board', error: true },
}
