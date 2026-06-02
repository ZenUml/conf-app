import { Component } from 'vue';
import globals from '@/model/globals';
import { mountRoot } from '@/mount-root';
import { Diagram, NULL_DIAGRAM } from '@/model/Diagram/Diagram';
import { tryFullscreenViewerPaywall } from '@/utils/paywall/mountPaywallGate';
import type { MacroKind } from '@/components/UpgradePrompt/buildAdvocacyMessage';
import {
  applyViewerLoadOutcome,
  getForgeCustomContentId,
  mapThrownViewerLoadError,
  setViewerLoadState,
} from '@/utils/viewerLoadOutcome';

export { publishLoadedDiagram } from '@/utils/viewerLoadOutcome';
import type { DiagramLoadError } from '@/model/store2/types';

export type ViewerLoadDiagramResult =
  | Diagram
  | undefined
  | {
      doc?: Diagram;
      loadError?: DiagramLoadError | null;
    };

export interface ViewerBootstrapOptions {
  macroKind: MacroKind;
  content: Component;
  contentProps?: Record<string, unknown>;
  loadDiagram: () => Promise<ViewerLoadDiagramResult>;
  afterLoad?: (doc: Diagram | undefined) => void | Promise<void>;
  onError?: (error: unknown) => void;
}

function normalizeViewerLoadResult(
  result: ViewerLoadDiagramResult,
): { doc?: Diagram; loadError?: DiagramLoadError | null } {
  if (result && typeof result === 'object' && 'doc' in result) {
    return {
      doc: result.doc,
      loadError: result.loadError ?? null,
    };
  }
  return { doc: result as Diagram | undefined, loadError: null };
}

export async function bootstrapForgeViewer(options: ViewerBootstrapOptions): Promise<void> {
  try {
    await globals.apWrapper.initializeContext();
    if (globals.apWrapper.isDisplayMode()) {
      setViewerLoadState('loading', null);
    }
    const paywalled = await tryFullscreenViewerPaywall({
      doc: NULL_DIAGRAM,
      content: options.content,
      contentProps: options.contentProps,
      macroKind: options.macroKind,
    });
    if (!paywalled) {
      mountRoot(NULL_DIAGRAM, options.content, options.contentProps);
    }

    const loadResult = normalizeViewerLoadResult(await options.loadDiagram());
    const doc = applyViewerLoadOutcome({
      doc: loadResult.doc,
      loadError: loadResult.loadError,
      customContentId: getForgeCustomContentId(),
      macroKind: options.macroKind,
    });
    await options.afterLoad?.(doc);
  } catch (error) {
    if (globals.apWrapper.isDisplayMode()) {
      applyViewerLoadOutcome({
        doc: undefined,
        loadError: mapThrownViewerLoadError(error),
        customContentId: getForgeCustomContentId(),
        macroKind: options.macroKind,
      });
    }
    if (options.onError) {
      options.onError(error);
      return;
    }
    throw error;
  }
}
