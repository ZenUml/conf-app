import type { Args, Meta, StoryObj } from '@storybook/vue3-vite'
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
          'Three-dot overflow menu used in the diagram viewer toolbar. Renders a circular trigger button that opens a popover menu above the trigger. The menu content is provided via a default slot. Closes on Escape, outside click, or when a slot item calls `close()`.',
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

/** Trigger button in its default idle state — menu closed. */
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
          <button class="overflow-menu-item" role="menuitem">
            <span class="overflow-menu-item-icon">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"/></svg>
            </span>
            Export
          </button>
          <button class="overflow-menu-item" role="menuitem">
            <span class="overflow-menu-item-icon">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15M12 9l-3 3m0 0 3 3m-3-3h12.75"/></svg>
            </span>
            Fullscreen
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
 * Menu open — popover visible above the trigger.
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
          <button class="overflow-menu-item" role="menuitem">
            <span class="overflow-menu-item-icon">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"/></svg>
            </span>
            Export
          </button>
          <button class="overflow-menu-item" role="menuitem">
            <span class="overflow-menu-item-icon">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15M12 9l-3 3m0 0 3 3m-3-3h12.75"/></svg>
            </span>
            Fullscreen
          </button>
        </OverflowMenu>
      </div>
    `,
  }),
}

// ---------------------------------------------------------------------------
// Export + Fullscreen actions (typical viewer toolbar set)
// ---------------------------------------------------------------------------

/**
 * The two actions present in the viewer toolbar: Export and Fullscreen.
 * Both items call `close()` from the slot scope after the action runs.
 */
export const ExportAndFullscreen: Story = {
  args: {
    triggerLabel: 'More actions',
  },
  render: (args: Args) => ({
    components: { OverflowMenu },
    setup() {
      function onExport(close: () => void) {
        alert('Export triggered')
        close()
      }
      function onFullscreen(close: () => void) {
        alert('Fullscreen triggered')
        close()
      }
      return { args, onExport, onFullscreen }
    },
    template: `
      <div style="display: inline-flex; align-items: center; padding: 4px; margin-top: 80px; background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 8px;">
        <OverflowMenu v-bind="args" v-slot="{ close }">
          <button class="overflow-menu-item" role="menuitem" @click="onExport(close)">
            <span class="overflow-menu-item-icon">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"/></svg>
            </span>
            Export
          </button>
          <button class="overflow-menu-item" role="menuitem" @click="onFullscreen(close)">
            <span class="overflow-menu-item-icon">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15"/></svg>
            </span>
            Fullscreen
          </button>
        </OverflowMenu>
      </div>
    `,
  }),
}

// ---------------------------------------------------------------------------
// Many actions
// ---------------------------------------------------------------------------

/**
 * A fuller action set (Export, Fullscreen, Copy link, Print) — shows how
 * the popover stretches to fit more items without overflowing.
 */
export const ManyActions: Story = {
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

// ---------------------------------------------------------------------------
// In a viewer toolbar (contextual placement)
// ---------------------------------------------------------------------------

/**
 * OverflowMenu placed at the right end of a mock viewer toolbar — mirrors
 * real production placement so reviewers can evaluate sizing and spacing in
 * context.
 */
export const InViewerToolbar: Story = {
  args: {
    triggerLabel: 'More',
  },
  render: (args: Args) => ({
    components: { OverflowMenu },
    setup() {
      return { args }
    },
    template: `
      <div style="display: flex; align-items: center; justify-content: space-between; width: 480px; height: 40px; padding: 0 8px; background: #fff; border: 1px solid #E5E7EB; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,0.06); margin-top: 80px;">
        <span style="font-size: 13px; font-weight: 500; color: #374151;">Payment Flow Diagram</span>
        <div style="display: flex; align-items: center; gap: 4px;">
          <!-- Placeholder for other toolbar buttons -->
          <button style="width:30px;height:30px;border:none;background:transparent;border-radius:9999px;cursor:pointer;color:#6B7280;display:inline-flex;align-items:center;justify-content:center;">
            <svg width="16" height="16" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15"/></svg>
          </button>
          <OverflowMenu v-bind="args">
            <button class="overflow-menu-item" role="menuitem">
              <span class="overflow-menu-item-icon">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"/></svg>
              </span>
              Export
            </button>
            <button class="overflow-menu-item" role="menuitem">
              <span class="overflow-menu-item-icon">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244"/></svg>
              </span>
              Copy link
            </button>
          </OverflowMenu>
        </div>
      </div>
    `,
  }),
}
