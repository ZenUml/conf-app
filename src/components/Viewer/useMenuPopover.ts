import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { MENU_ITEM_SELECTOR, handleMenuKeydown, shouldAlignMenuStart } from './menuKeyboard'

/**
 * Open/close controller shared by the viewer header menus (OverflowMenu and
 * CopyForAiMenu): document click-outside + Escape listeners, first-item focus
 * and start-alignment on open, and the two close flavours.
 *
 * - `close()` closes and returns focus to the trigger (Escape, an item picked).
 * - `dismiss()` closes without moving focus (Tab, a click elsewhere).
 *
 * Bind the returned refs with `ref="containerRef" | "triggerRef" | "menuRef"`
 * in the template (return them from `setup()`). Emits `opened` / `closed`.
 */
export function useMenuPopover(emit: (event: 'opened' | 'closed') => void) {
  const open = ref(false)
  const alignStart = ref(false)
  const containerRef = ref<HTMLElement | null>(null)
  const triggerRef = ref<HTMLElement | null>(null)
  const menuRef = ref<HTMLElement | null>(null)

  function openMenu() {
    if (open.value) return
    open.value = true
    emit('opened')
    alignStart.value = false
    nextTick(() => {
      alignStart.value = shouldAlignMenuStart(menuRef.value)
      containerRef.value?.querySelector<HTMLElement>(MENU_ITEM_SELECTOR)?.focus()
    })
  }

  function close() {
    if (!open.value) return
    open.value = false
    emit('closed')
    triggerRef.value?.focus()
  }

  function dismiss() {
    if (!open.value) return
    open.value = false
    emit('closed')
  }

  function toggle() {
    if (open.value) close()
    else openMenu()
  }

  function onMenuKeydown(e: KeyboardEvent) {
    if (menuRef.value) handleMenuKeydown(e, menuRef.value, { close, dismiss })
  }

  function onDocMouseDown(e: MouseEvent) {
    if (open.value && containerRef.value && !containerRef.value.contains(e.target as Node)) dismiss()
  }

  // Escape while focus is outside the menu (e.g. still on the trigger).
  function onDocKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape' && open.value) {
      e.preventDefault()
      e.stopPropagation()
      close()
    }
  }

  onMounted(() => {
    document.addEventListener('mousedown', onDocMouseDown)
    document.addEventListener('keydown', onDocKeyDown)
  })
  onBeforeUnmount(() => {
    document.removeEventListener('mousedown', onDocMouseDown)
    document.removeEventListener('keydown', onDocKeyDown)
  })

  return { open, alignStart, containerRef, triggerRef, menuRef, toggle, openMenu, close, dismiss, onMenuKeydown }
}
