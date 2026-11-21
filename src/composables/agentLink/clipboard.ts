// src/composables/agentLink/clipboard.ts
//
// Clipboard write shared by the Connect MCP surfaces (the macro's dialog and
// the Home page card). Forge iframes may deny the async Clipboard API, so a
// failure falls back to execCommand('copy') on a hidden textarea. Resolves
// false when both fail, so the caller can show "Select & copy" instead.
export async function writeClipboard(text: string): Promise<boolean> {
  return (await writeClipboardDetailed(text)).ok
}

export type ClipboardWriteResult = {
  ok: boolean
  /** Which path wrote the text; 'none' when both failed. */
  method: 'clipboard_api' | 'exec_command' | 'none'
  /** Name of the Clipboard API error (e.g. 'NotAllowedError'), when it threw. */
  errorName?: string
}

/** Same write as `writeClipboard`, but says which path worked or why none did. */
export async function writeClipboardDetailed(text: string): Promise<ClipboardWriteResult> {
  let errorName: string | undefined
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return { ok: true, method: 'clipboard_api' }
    } catch (e) {
      errorName = (e as { name?: string } | null)?.name || 'Error'
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
    return ok ? { ok: true, method: 'exec_command' } : { ok: false, method: 'none', errorName }
  } catch (e) {
    return { ok: false, method: 'none', errorName: errorName ?? ((e as { name?: string } | null)?.name || 'Error') }
  }
}
