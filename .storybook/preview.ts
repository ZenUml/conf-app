import type { Preview } from '@storybook/vue3-vite'
import '../src/assets/tailwind.css'

const preview: Preview = {
  parameters: {
    layout: 'fullscreen',
    options: {
      // Keep the product's main working interfaces at the top in the order people
      // look for them. Secondary surfaces and cross-surface components follow.
      storySort: {
        order: [
          'View',
          'Editor',
          ['Diagram', 'Graph'],
          'Fullscreen',
          'PNG Export',
          'Byline',
          'Page banner',
          'Get Started',
          'Dashboard',
          'Homepage feed',
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
