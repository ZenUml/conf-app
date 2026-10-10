/**
 * Keyboard model shared by the viewer header menus (OverflowMenu "More" and
 * CopyForAiMenu), per the staged-header prototype and the WAI-ARIA menu
 * button pattern: ↑ ↓ wrap, Home / End jump, Escape closes and returns focus
 * to the trigger, Tab closes and lets focus move on.
 *
 * Escape is consumed here (preventDefault + stopPropagation) so one press
 * closes one layer: it must not also reach the Fullscreen exit or the Source
 * panel's Escape handling.
 */
/** What the arrow keys walk and what gets initial focus: plain and checkbox items alike. */
export const MENU_ITEM_SELECTOR = '[role="menuitem"]:not([disabled]), [role="menuitemcheckbox"]:not([disabled])'

export function menuItems(menu: HTMLElement): HTMLElement[] {
  return Array.from(menu.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR))
}

export function handleMenuKeydown(
  event: KeyboardEvent,
  menu: HTMLElement,
  actions: { close: () => void; dismiss: () => void },
): void {
  const items = menuItems(menu)
  const index = items.indexOf(document.activeElement as HTMLElement)
  const go = (next: number) => {
    event.preventDefault()
    if (!items.length) return
    items[(next + items.length) % items.length].focus()
  }
  switch (event.key) {
    case 'ArrowDown': go(index + 1); break
    case 'ArrowUp': go(index < 0 ? items.length - 1 : index - 1); break
    case 'Home': go(0); break
    case 'End': go(items.length - 1); break
    case 'Escape':
      event.preventDefault()
      event.stopPropagation()
      actions.close()
      break
    case 'Tab':
      actions.dismiss()
      break
    default:
  }
}

/**
 * Header menus are right-anchored to their trigger. On a narrow card (a short
 * diagram with the trigger near the left) that would push the popover past
 * the viewer frame's left edge, so anchor it to the trigger's left instead.
 * The boundary is the nearest .viewer-frame, else the viewport.
 */
export function shouldAlignMenuStart(popover: HTMLElement | undefined | null): boolean {
  if (!popover) return false
  const boundary = popover.closest('.viewer-frame')?.getBoundingClientRect().left ?? 0
  return popover.getBoundingClientRect().left < boundary
}
