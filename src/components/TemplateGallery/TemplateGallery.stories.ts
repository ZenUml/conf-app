import type { Meta, StoryObj } from '@storybook/vue3-vite'
import TemplateGallery from './TemplateGallery.vue'
import { DiagramType } from '@/model/Diagram/Diagram'

const meta: Meta<typeof TemplateGallery> = {
  title: 'Editor/Diagram/TemplateGallery',
  component: TemplateGallery,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Starter-template gallery panel (#334). Two things open it: the Templates button in the ' +
          'editor Header, and — once per cloudId and macro type per browser — a brand-new macro ' +
          'that is still blank, which auto-opens it instead of showing an empty canvas ' +
          '(Header.vue, template_gallery_trigger: auto_first_open). Graph, OpenAPI and Embed have ' +
          'no templates, so neither path fires for them. One click applies a curated DSL template ' +
          'into the editor buffer. Pure component: diagramType prop in, select/close events out.',
      },
    },
  },
}
export default meta
type Story = StoryObj<typeof TemplateGallery>

export const Mermaid: Story = {
  args: { diagramType: DiagramType.Mermaid, visible: true },
}

export const Sequence: Story = {
  args: { diagramType: DiagramType.Sequence, visible: true },
}

export const PlantUml: Story = {
  args: { diagramType: DiagramType.PlantUml, visible: true },
}
