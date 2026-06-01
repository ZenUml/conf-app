import type { Preview } from '@storybook/vue3-vite'
import '../src/assets/tailwind.css'

const preview: Preview = {
  parameters: {
    layout: 'fullscreen',
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
