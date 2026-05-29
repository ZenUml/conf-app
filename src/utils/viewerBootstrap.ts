import { Component } from 'vue';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';
import globals from '@/model/globals';
import { mountRoot } from '@/mount-root';
import store from '@/model/store2';
import { Diagram, NULL_DIAGRAM } from '@/model/Diagram/Diagram';
import { tryFullscreenViewerPaywall } from '@/utils/paywall/mountPaywallGate';
import type { MacroKind } from '@/components/UpgradePrompt/buildAdvocacyMessage';

export interface ViewerBootstrapOptions {
  macroKind: MacroKind;
  content: Component;
  contentProps?: Record<string, unknown>;
  loadDiagram: () => Promise<Diagram | undefined>;
  afterLoad?: (doc: Diagram | undefined) => void | Promise<void>;
  onError?: (error: unknown) => void;
}

export function publishLoadedDiagram(doc: Diagram | undefined): Diagram {
  const diagram = doc ?? NULL_DIAGRAM;
  store.state.diagram = diagram;
  window.diagram = diagram;
  console.log('loadDiagram - window.diagram', window.diagram);
  return diagram;
}

export async function bootstrapForgeViewer(options: ViewerBootstrapOptions): Promise<void> {
  try {
    await globals.apWrapper.initializeContext();
    trackAnalyticsEvent('macro_viewed', {
      feature_area: 'macro',
      surface: 'viewer',
      macro_type: options.macroKind,
      entry_point: 'page_view',
    });

    const paywalled = await tryFullscreenViewerPaywall({
      doc: NULL_DIAGRAM,
      content: options.content,
      contentProps: options.contentProps,
      macroKind: options.macroKind,
    });
    if (!paywalled) {
      mountRoot(NULL_DIAGRAM, options.content, options.contentProps);
    }

    const doc = await options.loadDiagram();
    publishLoadedDiagram(doc);
    await options.afterLoad?.(doc);
  } catch (error) {
    if (options.onError) {
      options.onError(error);
      return;
    }
    throw error;
  }
}
