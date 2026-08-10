import type { Meta, StoryObj } from '@storybook/vue3-vite'
import TemplateGallery from './TemplateGallery.vue'
import { DiagramType } from '@/model/Diagram/Diagram'

const meta: Meta<typeof TemplateGallery> = {
  title: 'Editor/TemplateGallery',
  component: TemplateGallery,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Starter-template gallery panel (#334). Opens from the Templates button in the editor Header; one click applies a curated DSL template into the editor buffer. Pure component: diagramType prop in, select/close events out.',
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
