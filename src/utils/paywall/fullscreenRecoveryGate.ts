import { markRaw, type Component } from 'vue';
import { type Diagram, NULL_DIAGRAM } from '@/model/Diagram/Diagram';
import { mountRoot } from '@/mount-root';
import FullscreenRecoveryHost from '@/components/FullscreenRecoveryHost.vue';
import { getFullscreenRecovery } from '@/apis/fullscreenRecovery';
import { getContext, getView, navigateToAppPage } from '@/model/globals/forgeGlobal';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';
import { onVisibleDiagramReady } from '@/utils/fullscreenReady';
import type { RecoveryScenario } from '../../../shared/fullscreenRecovery';

/** Independent, explicit pilot policy. Never changes the editor's count/paid policy. */
export async function mountFullscreenRecovery(opts: {
  doc?: Diagram;
  existingExemption?: boolean;
  content: Component;
  contentProps?: Record<string, unknown>;
}): Promise<'handled' | 'disabled' | 'unavailable'> {
  try {
    const snapshot = await getFullscreenRecovery();
    if (opts.existingExemption && snapshot.exemptionOverrideReviewed !== true) return 'disabled';
    if (snapshot.state === 'disabled' || snapshot.state === 'unavailable') return snapshot.state;
    const context = await getContext();
    mountRoot(opts.doc ?? NULL_DIAGRAM, FullscreenRecoveryHost, {
      initialSnapshot: snapshot, content: markRaw(opts.content), contentProps: opts.contentProps ?? {},
      context: {
        contentId: context.extension?.content?.id,
        customContentId: context.extension?.config?.customContentId || context.extension?.modal?.customContentId,
        spaceKey: context.extension?.space?.key,
      },
      returnInline: async () => { await (await getView()).close(); },
      planUsage: async (requestId?: string, scenarios?: RecoveryScenario[]) => {
        const query = new URLSearchParams({ source: 'fullscreen_recovery' });
        if (requestId) query.set('request', requestId);
        const pageId = context.extension?.content?.id;
        if (pageId && /^\d+$/.test(pageId)) query.set('page_id', pageId);
        if (scenarios?.length) query.set('scenes', scenarios.join(','));
        const navigated = await navigateToAppPage(`zenuml-plan-usage?${query}`);
        if (!navigated) throw new Error('Plan and usage navigation is unavailable');
      },
    });
    return 'handled';
  } catch {
    // Neither a new policy lookup nor a missing migration may strand a viewer.
    return 'unavailable';
  }
}

export function observeOrdinaryFullscreenReady(accessSource: 'existing' | 'fail_open'): void {
  let stop = () => {};
  const cleanup = () => { stop(); window.removeEventListener('pagehide', cleanup); };
  stop = onVisibleDiagramReady(() => document.getElementById('app'), (macroType) => {
    trackAnalyticsEvent('fullscreen_view_ready', {
      feature_area: 'macro', surface: 'viewer', feature: 'fullscreen',
      policy_version: 'fullscreen-contact-v1', entry_point: 'page_view',
      macro_type: macroType, access_source: accessSource, attempt_id: crypto.randomUUID(),
    });
    cleanup();
  });
  window.addEventListener('pagehide', cleanup, { once: true });
}
