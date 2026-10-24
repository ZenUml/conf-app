import type { Args, Meta, StoryObj } from '@storybook/vue3-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { ref } from 'vue'
import OverflowMenu from './OverflowMenu.vue'

type Story = StoryObj<typeof OverflowMenu>

const meta: Meta<typeof OverflowMenu> = {
  title: 'Viewer/OverflowMenu',
  component: OverflowMenu,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Three-dot overflow menu at the right end of the viewer\'s bottom pill row (GenericViewer.vue). In production it holds exactly one item, Download debug info; Export, Fullscreen and Copy page link are separate pill buttons, not menu items. The trigger opens a popover above itself, which closes on Escape, on an outside click, or when a slot item calls close().',
      },
    },
  },
  argTypes: {
    triggerLabel: {
      control: 'text',
      description: 'Accessible label for the trigger button (aria-label + title)',
      defaultValue: 'More',
    },
  },
}

export default meta

// ---------------------------------------------------------------------------
// Collapsed (default idle state)
// ---------------------------------------------------------------------------

/** Trigger button in its idle state — menu closed. The slot carries the one item production uses. */
export const Collapsed: Story = {
  args: {
    triggerLabel: 'More',
  },
  render: (args: Args) => ({
    components: { OverflowMenu },
    setup() {
      return { args }
    },
    template: `
      <div style="display: inline-flex; align-items: center; padding: 4px; background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 8px;">
        <OverflowMenu v-bind="args">
          <button type="button" role="menuitem" class="overflow-menu-item">
            <span class="overflow-menu-item-icon">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M9 4.5a3 3 0 0 1 6 0M5 8h14M7 8v6a5 5 0 0 0 10 0V8M4 11h3M17 11h3M5 17l-1.5 2M19 17l1.5 2M12 14v6m0 0-2.25-2.25M12 20l2.25-2.25" />
              </svg>
            </span>
            <span>Download debug info</span>
          </button>
        </OverflowMenu>
      </div>
    `,
  }),
}

// ---------------------------------------------------------------------------
// Expanded (menu open)
// ---------------------------------------------------------------------------

/**
 * Menu open — popover visible above the trigger, showing the production item.
 * Uses a Vue ref to force `open` to true on mount so the popover is
 * immediately visible in the canvas without requiring a click.
 */
export const Expanded: Story = {
  args: {
    triggerLabel: 'More',
  },
  render: (args: Args) => ({
    components: { OverflowMenu },
    setup() {
      const menuRef = ref<InstanceType<typeof OverflowMenu> | null>(null)
      // Open the menu after the component mounts so the popover is visible.
      function onMounted() {
        if (menuRef.value) {
          ;(menuRef.value as any).openMenu()
        }
      }
      return { args, menuRef, onMounted }
    },
    template: `
      <div style="display: inline-flex; align-items: center; padding: 4px; margin-top: 80px; background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 8px;">
        <OverflowMenu ref="menuRef" v-bind="args" @vue:mounted="onMounted">
          <button type="button" role="menuitem" class="overflow-menu-item">
            <span class="overflow-menu-item-icon">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M9 4.5a3 3 0 0 1 6 0M5 8h14M7 8v6a5 5 0 0 0 10 0V8M4 11h3M17 11h3M5 17l-1.5 2M19 17l1.5 2M12 14v6m0 0-2.25-2.25M12 20l2.25-2.25" />
              </svg>
            </span>
            <span>Download debug info</span>
          </button>
        </OverflowMenu>
      </div>
    `,
  }),
}

// ---------------------------------------------------------------------------
// Export + Fullscreen actions (typical viewer toolbar set)
// ---------------------------------------------------------------------------

/** Clicking the item runs its action and then calls the slot's close(); the status line below records the click. */
export const ItemClosesMenu: Story = {
  name: 'Item click closes the menu',
  args: {
    triggerLabel: 'More actions',
  },
  render: (args: Args) => ({
    components: { OverflowMenu },
    setup() {
      const status = ref('')
      function onDownload(close: () => void) {
        status.value = 'Download debug info clicked'
        close()
      }
      return { args, status, onDownload }
    },
    template: `
      <div style="display: inline-block; align-items: center; padding: 4px; margin-top: 80px; background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 8px;">
        <OverflowMenu v-bind="args" v-slot="{ close }">
          <button type="button" role="menuitem" class="overflow-menu-item" @click="onDownload(close)">
            <span class="overflow-menu-item-icon">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M9 4.5a3 3 0 0 1 6 0M5 8h14M7 8v6a5 5 0 0 0 10 0V8M4 11h3M17 11h3M5 17l-1.5 2M19 17l1.5 2M12 14v6m0 0-2.25-2.25M12 20l2.25-2.25" />
              </svg>
            </span>
            <span>Download debug info</span>
          </button>
        </OverflowMenu>
        <p data-testid="overflow-status" style="font-size: 12px; color: #6B7280; margin: 8px 0 0;">{{ status }}</p>
      </div>
    `,
  }),
  play: async () => {
    const canvas = within(document.body)
    await userEvent.click(canvas.getByRole('button', { name: 'More actions' }))
    await userEvent.click(await canvas.findByRole('menuitem', { name: 'Download debug info' }))
    await expect(canvas.getByTestId('overflow-status')).toHaveTextContent('Download debug info clicked')
    // close() came from the slot scope, so the popover is gone as well.
    await waitFor(() => expect(canvas.queryByRole('menu')).toBeNull())
  },
}

// ---------------------------------------------------------------------------
// Many actions
// ---------------------------------------------------------------------------

/** Not a production configuration — shows how the popover grows with more items without overflowing. */
export const FourItems: Story = {
  name: 'Four items (synthetic)',
  args: {
    triggerLabel: 'More',
  },
  render: (args: Args) => ({
    components: { OverflowMenu },
    setup() {
      return { args }
    },
    template: `
      <div style="display: inline-flex; align-items: center; padding: 4px; margin-top: 120px; background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 8px;">
        <OverflowMenu v-bind="args">
          <button class="overflow-menu-item" role="menuitem">
            <span class="overflow-menu-item-icon">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"/></svg>
            </span>
            Export
          </button>
          <button class="overflow-menu-item" role="menuitem">
            <span class="overflow-menu-item-icon">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15"/></svg>
            </span>
            Fullscreen
          </button>
          <button class="overflow-menu-item" role="menuitem">
            <span class="overflow-menu-item-icon">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244"/></svg>
            </span>
            Copy link
          </button>
          <button class="overflow-menu-item" role="menuitem">
            <span class="overflow-menu-item-icon">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0 1 10.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0 .229 2.523a1.125 1.125 0 0 1-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0 0 21 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 0 0-1.913-.247M6.34 18H5.25A2.25 2.25 0 0 1 3 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 0 1 1.913-.247m10.5 0a48.536 48.536 0 0 0-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18 10.5h.008v.008H18V10.5Zm-6 0h.008v.008H6V10.5Z"/></svg>
            </span>
            Print
          </button>
        </OverflowMenu>
      </div>
    `,
  }),
}

// ---------------------------------------------------------------------------
// Custom trigger label
// ---------------------------------------------------------------------------

/**
 * A non-default `triggerLabel` — verifies the accessible label propagates
 * to `aria-label` and the native `title` tooltip.
 */
export const CustomTriggerLabel: Story = {
  args: {
    triggerLabel: 'Diagram actions',
  },
  render: (args: Args) => ({
    components: { OverflowMenu },
    setup() {
      return { args }
    },
    template: `
      <div style="display: inline-flex; align-items: center; padding: 4px; background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 8px;">
        <OverflowMenu v-bind="args">
          <button class="overflow-menu-item" role="menuitem">Action one</button>
          <button class="overflow-menu-item" role="menuitem">Action two</button>
        </OverflowMenu>
      </div>
    `,
  }),
}
