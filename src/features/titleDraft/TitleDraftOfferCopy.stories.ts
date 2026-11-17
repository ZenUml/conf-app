import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { expect, within } from 'storybook/test'
import type { TitleDraftCopyVariant } from '@/utils/analytics/catalog'
import { TITLE_DRAFT_OFFER_COPY } from './copyExperiment'

/** A representative fixture only: production uses Confluence's native showFlag. */
const meta: Meta<{ variant: TitleDraftCopyVariant }> = {
  title: 'Page banner/TitleDraftOfferCopy',
  parameters: { layout: 'fullscreen', controls: { disable: true } },
  render: (args) => ({
    setup: () => ({ copy: TITLE_DRAFT_OFFER_COPY[args.variant] }),
    template: `
      <div style="position:relative;width:1100px;min-height:440px;background:#f7f8f9;font:14px/20px 'Atlassian Sans',Arial,sans-serif;color:#172b4d">
        <p style="padding:24px;margin:0;color:#626f86">Story fixture — representative native Forge flag. Production is rendered by Confluence.</p>
        <aside role="alert" aria-label="Diagram offer" style="position:absolute;bottom:24px;left:24px;display:flex;gap:16px;width:400px;box-sizing:border-box;background:white;border-radius:4px;padding:20px;box-shadow:0 4px 16px #091e4240">
          <span aria-hidden="true" style="flex:none;border-radius:50%;background:#0c66e4;color:white;width:20px;height:20px;text-align:center;font-weight:bold">i</span>
          <div style="flex:1;min-width:0">
            <h2 style="font:600 14px/20px 'Atlassian Sans',Arial,sans-serif;margin:0 0 8px">{{ copy.title }}</h2>
            <p style="margin:0 0 12px">{{ copy.description }}</p>
            <div style="display:flex;gap:16px">
              <button type="button" style="border:0;padding:0;background:none;color:#0c66e4;font:600 14px/20px Arial,sans-serif;cursor:pointer">{{ copy.primary }}</button>
              <button type="button" style="border:0;padding:0;background:none;color:#0c66e4;font:600 14px/20px Arial,sans-serif;cursor:pointer">{{ copy.secondary }}</button>
            </div>
          </div>
          <span aria-hidden="true" style="flex:none;font-size:20px;line-height:20px">×</span>
        </aside>
      </div>`,
  }),
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const copy = TITLE_DRAFT_OFFER_COPY[args.variant]
    await expect(canvas.getByRole('heading', { name: copy.title })).toBeVisible()
    await expect(canvas.getByText(copy.description)).toBeVisible()
    await expect(canvas.getByRole('button', { name: copy.primary })).toBeVisible()
    await expect(canvas.getByRole('button', { name: copy.secondary })).toBeVisible()
  },
}
export default meta
type Story = StoryObj<typeof meta>
export const ControlA: Story = { args: { variant: 'A' } }
export const VariantB: Story = { args: { variant: 'B' } }
