// src/composables/agentLink/clipboard.ts
//
// Clipboard write shared by the Connect MCP surfaces (the macro's dialog and
// the Home page card). Forge iframes may deny the async Clipboard API, so a
// failure falls back to execCommand('copy') on a hidden textarea. Resolves
// false when both fail, so the caller can show "Select & copy" instead.
export async function writeClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      /* fall through to the legacy path */
    }
  }
  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.top = '-9999px'
    textarea.setAttribute('readonly', '')
    document.body.appendChild(textarea)
    textarea.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(textarea)
    return ok
  } catch {
    return false
  }
}
