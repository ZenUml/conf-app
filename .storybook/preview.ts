import type { Preview } from '@storybook/vue3-vite'
import '../src/assets/tailwind.css'

const preview: Preview = {
  parameters: {
    layout: 'fullscreen',
    options: {
      // Without this the sidebar is in file-discovery order, which is arbitrary and
      // reshuffles whenever a story file is added. The groups are surfaces (see
      // src/components/storyTitles.spec.ts), so order them by the macro's lifecycle —
      // what a reader meets first on a Confluence page, then what they open, then the
      // things layered on top — and put the non-surface `Shared` bucket last.
      storySort: {
        order: [
          'Viewer',
          'Editor',
          ['Diagram', 'Graph'],
          'Modal',
          'Page banner',
          'Homepage feed',
          'Get started',
          'Shared',
        ],
      },
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    viewport: {
      viewports: {
        forgeModal: {
          name: 'Forge modal iframe',
          styles: {
            width: '700px',
            height: '600px',
          },
        },
      },
    },
  },
}

export default preview
