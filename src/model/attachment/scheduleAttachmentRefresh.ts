import globals from '@/model/globals';
import { trackEvent, serializeError } from '@/utils/window';

/**
 * Waits for the render to settle, then uploads the PNG attachment if this is a
 * view of an editable macro. One copy of what the four Forge entries
 * (forgeIndex, embed, graph, swagger) each used to carry.
 *
 * `getContent` is evaluated when the timer fires, not when this is called.
 * A caller that must snapshot the content earlier passes `() => captured`.
 *
 * Error reports use event `create_attachment` with a `diagram_type` property.
 * Cut-over 2026-10-23: before it, forgeIndex reported
 * `create_attachment<diagramType>` (no separator, e.g. `create_attachmentsequence`);
 * the other three reported plain `create_attachment` without the type.
 */
export function scheduleAttachmentRefresh(
  getContent: () => string,
  diagramType: string,
  delayMs = 1500,
): void {
  setTimeout(async () => {
    try {
      // ZEN-1170 Defect 1: the missing-customContentId case is handled
      // centrally inside createAttachmentIfContentChanged (Attachment.ts)
      // — it emits the `missing_custom_content_id` skip telemetry and
      // returns early. Per-callsite fast paths previously here suppressed
      // that central event, hiding the highest-volume class of skips.
      if (globals.apWrapper.isDisplayMode() && await globals.apWrapper.canUserEdit()) {
        // Loaded on demand: forgeIndex used to import Attachment lazily to
        // keep it out of the main chunk.
        const { default: createAttachmentIfContentChanged } = await import('@/model/Attachment');
        await createAttachmentIfContentChanged(getContent(), diagramType);
      } else {
        console.debug("Attachment will not be created as it's not in view mode or the user is unauthorized to edit.");
      }
    } catch (e: any) {
      // Do not re-throw the error
      console.error("Error when creating attachment", e);
      trackEvent(
        JSON.stringify(describeError(e)),
        'create_attachment',
        'error',
        { diagram_type: diagramType },
      );
    }
  }, delayMs);
}

function describeError(e: any): Record<string, any> {
  const details: Record<string, any> = { message: e instanceof Error ? e.message : serializeError(e) };
  if (e?.xhr) {
    details.xhr = { status: e.xhr.status, statusText: e.xhr.statusText };
    try {
      // For HTML responses, extract text content to avoid HTML tags
      if (e.xhr.responseText && e.xhr.responseText.includes('<!doctype html>')) {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = e.xhr.responseText;
        details.xhr.responseDetails = tempDiv.textContent?.substring(0, 500) || 'HTML response (extracted text)';
      } else {
        details.xhr.responseDetails = e.xhr.responseText?.substring(0, 500) || 'No response text';
      }
    } catch (parseError: any) {
      details.xhr.responseDetails = 'Error parsing response: ' + parseError.message;
    }
  }
  return details;
}
