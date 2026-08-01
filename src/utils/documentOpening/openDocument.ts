// src/utils/documentOpening/openDocument.ts
import { Diagram } from '@/model/Diagram/Diagram';
import globals from '@/model/globals';
import { reportOrphanObserved } from '@/utils/orphanTelemetry';
import type { OpenDocumentOptions, OpenOutcome } from './types';

export async function openDocument(opts: OpenDocumentOptions): Promise<OpenOutcome> {
  const { policy, context, pageId, target } = opts;
  const resolved = target.resolveId(context);

  let doc: Diagram | undefined;
  let recoveredFromOrphan = false;

  if (resolved?.contentId) {
    const { contentId } = resolved;
    const copyCheckMode = policy === 'read' ? 'cross-page-only' : 'full';
    const loaded = await globals.apWrapper.loadCustomContentWithOrphanRecovery(
      pageId, contentId, { copyCheckMode },
    );
    doc = loaded.customContent?.value;

    if (loaded.recoveredFromOrphanId && doc) {
      doc.recoveredFromOrphan = true;
      doc.recoveredFromOrphanId = loaded.recoveredFromOrphanId;
      recoveredFromOrphan = true;
      reportOrphanObserved(pageId, contentId, target.macroType, loaded.probeResult, {
        recoveryUsed: true,
        recoveredId: loaded.customContent?.id != null ? String(loaded.customContent.id) : undefined,
      });
    } else if (!doc) {
      reportOrphanObserved(pageId, contentId, target.macroType, loaded.probeResult, {
        recoveryUsed: false,
      });
    }
  }

  if (!doc) {
    for (const fallback of target.legacyFallbacks) {
      doc = await fallback({ context, pageId });
      if (doc) {
        recoveredFromOrphan = true;
        break;
      }
    }
  }

  if (!doc) {
    if (!resolved?.contentId && target.onMiss === 'default-doc') {
      return {
        kind: 'opened',
        document: { doc: target.defaultDoc!(), origin: { recoveredFromOrphan: false } },
      };
    }
    return { kind: 'failed', error: { kind: 'not_found', customContentId: resolved?.contentId } };
  }

  return {
    kind: 'opened',
    document: {
      doc,
      origin: {
        contentId: resolved?.contentId,
        source: resolved?.source,
        recoveredFromOrphan,
        originalCustomContentId: resolved?.contentId,
        recoveryPageId: pageId,
      },
    },
  };
}
