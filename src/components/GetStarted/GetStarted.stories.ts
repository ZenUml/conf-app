import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { expect, within } from 'storybook/test'
import GetStarted from './GetStarted.vue'
import forgeGlobal from '@/model/globals/forgeGlobal'

type Story = StoryObj<typeof GetStarted>

/**
 * Stub out Forge-specific side-effects so Storybook renders cleanly:
 *  - forgeGlobal.isForge = false disables AP/bridge calls in trackEvent and openUrl
 *  - mockClientDomain lets getLocalStorageKey() produce stable keys for analytics
 */
function installMocks() {
  forgeGlobal.isForge = false
  forgeGlobal.isLite = true
  forgeGlobal.forgeContext = {
    accountId: 'storybook-user',
    siteUrl: 'https://example-tenant.atlassian.net',
    extension: {
      content: { id: 'storybook-page' },
      space: { key: 'STORY' },
    },
  }
  localStorage.setItem('mockClientDomain', 'example-tenant')
}

const meta: Meta<typeof GetStarted> = {
  title: 'Onboarding/GetStarted',
  component: GetStarted,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Full-page onboarding screen shown to admins after installing the Forge app. ' +
          'Displays a hero section, a feature grid with all five diagram types, a quick-start tutorial, ' +
          'and a resources panel. Fires a get_started_page_view analytics event on mount.',
      },
    },
  },
  decorators: [
    () => {
      installMocks()
      return {
        template: '<div style="background:#F4F5F7;min-height:100vh;"><story /></div>',
      }
    },
  ],
}

export default meta

/**
 * Full page render — all sections visible.
 * Use this as the reference story for the complete onboarding experience.
 */
export const Default: Story = {
  name: 'Default — full page',
  play: async () => {
    const canvas = within(document.body)
    await expect(await canvas.findByText(/Welcome to ZenUML Diagrams!/)).toBeVisible()
    await expect(canvas.getByText('What You Can Do')).toBeVisible()
    await expect(canvas.getByText('Quick Start Tutorial')).toBeVisible()
    await expect(canvas.getByText('Resources & Support')).toBeVisible()
  },
}

/**
 * Sequence diagram feature card.
 * The hero badge and Sequence Diagrams card are the primary entry point for ZenUML DSL users.
 */
export const SequenceDiagramType: Story = {
  name: 'Diagram type — Sequence',
  play: async () => {
    const canvas = within(document.body)
    await expect(await canvas.findByText('Sequence Diagrams')).toBeVisible()
    await expect(
      canvas.getByText(/Create ZenUML sequence diagrams with powerful syntax/)
    ).toBeVisible()
    // FORGE badge is shown in the hero alongside the welcome heading
    await expect(canvas.getByText('FORGE')).toBeVisible()
  },
}

/**
 * Mermaid diagram feature card.
 */
export const MermaidDiagramType: Story = {
  name: 'Diagram type — Mermaid',
  play: async () => {
    const canvas = within(document.body)
    await expect(await canvas.findByText('Mermaid Diagrams')).toBeVisible()
    await expect(
      canvas.getByText(/Write diagrams using Mermaid syntax/)
    ).toBeVisible()
  },
}

/**
 * Graph (DrawIO) diagram feature card.
 */
export const GraphDiagramType: Story = {
  name: 'Diagram type — Graph',
  play: async () => {
    const canvas = within(document.body)
    await expect(await canvas.findByText('Graph Diagrams')).toBeVisible()
    await expect(
      canvas.getByText(/DrawIO-powered graph editor/)
    ).toBeVisible()
  },
}

/**
 * OpenAPI diagram feature card.
 */
export const OpenApiDiagramType: Story = {
  name: 'Diagram type — OpenAPI',
  play: async () => {
    const canvas = within(document.body)
    await expect(await canvas.findByText('OpenAPI Specifications')).toBeVisible()
    await expect(
      canvas.getByText(/OpenAPI\/Swagger specifications with interactive documentation/)
    ).toBeVisible()
  },
}

/**
 * Tutorial section — three numbered steps for the quick-start flow.
 */
export const TutorialSteps: Story = {
  name: 'Tutorial — quick start steps',
  play: async () => {
    const canvas = within(document.body)
    await expect(await canvas.findByText('Insert a Macro')).toBeVisible()
    await expect(canvas.getByText('Create Your Diagram')).toBeVisible()
    await expect(canvas.getByText('Save and Share')).toBeVisible()
  },
}

/**
 * Resources section — documentation, videos, community, and issue reporting links.
 */
export const ResourceLinks: Story = {
  name: 'Resources — support links',
  play: async () => {
    const canvas = within(document.body)
    await expect(await canvas.findByRole('link', { name: /View Documentation/ })).toBeVisible()
    await expect(canvas.getByRole('link', { name: /Watch Videos/ })).toBeVisible()
    await expect(canvas.getByRole('link', { name: /Join Community/ })).toBeVisible()
    await expect(canvas.getByRole('link', { name: /Report Issue/ })).toBeVisible()
  },
}
