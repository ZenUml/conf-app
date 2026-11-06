<template>
  <div ref="host" class="recovery-host" data-testid="fullscreen-recovery-host">
    <section v-if="hasOpened" v-show="!showRequest" class="recovery-content">
      <component :is="content" v-bind="contentProps" />
      <div v-if="!dismissed" class="recovery-access">
        <FullscreenRecoveryStatus :snapshot="snapshot" @continue-request="showRequest = true" @dismiss="dismissNotice" />
        <p v-if="activationError" role="alert">
          Your diagram is open. We could not confirm the expiry time yet.
          <button type="button" :disabled="activating" @click="activate">Retry confirmation</button>
        </p>
      </div>
    </section>
    <FullscreenRecoveryGate v-if="!hasOpened || showRequest" :snapshot="snapshot" :context="context"
      :initial-view="showRequest ? 'request' : undefined" @update:snapshot="snapshot = $event"
      @open-fullscreen="open" @return-inline="returnInline" @plan-usage="goToPlanUsage" />
    <p v-if="openError" class="recovery-error" role="alert">Could not complete that action. Please try again.</p>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, type Component } from 'vue';
import type { RecoverySnapshot, RecoveryScenario } from '../../shared/fullscreenRecovery';
import type { MacroTypeValue } from '@/utils/analytics/catalog';
import FullscreenRecoveryGate from '@/components/FullscreenRecovery/FullscreenRecoveryGate.vue';
import FullscreenRecoveryStatus from '@/components/FullscreenRecovery/FullscreenRecoveryStatus.vue';
import { activateFullscreenRecovery, getFullscreenRecovery } from '@/apis/fullscreenRecovery';
import { onVisibleDiagramReady } from '@/utils/fullscreenReady';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';

const props = withDefaults(defineProps<{
  initialSnapshot: RecoverySnapshot;
  content: Component;
  contentProps?: Record<string, unknown>;
  context?: { contentId?: string; customContentId?: string; spaceKey?: string };
  returnInline: () => void;
  planUsage: (requestId?: string, scenarios?: RecoveryScenario[]) => void | Promise<void>;
}>(), { contentProps: () => ({}), context: () => ({}) });
const host = ref<HTMLElement | null>(null);
const snapshot = ref(props.initialSnapshot);
const hasOpened = ref(snapshot.value.state === 'active');
const showRequest = ref(false), dismissed = ref(false), activating = ref(false);
const activationError = ref(false), openError = ref(false);
let disposed = false, rendered = false;
let clock: ReturnType<typeof setInterval>;
let serverClockOffset = Date.parse(snapshot.value.serverNow) - Date.now();
const attemptId = crypto.randomUUID();
const common = () => ({ feature_area: 'upgrade' as const, surface: 'viewer' as const,
  feature: 'fullscreen' as const, policy_version: 'fullscreen-contact-v1' as const,
  attempt_id: attemptId, recovery_state: snapshot.value.state,
  recovery_request_id: snapshot.value.request?.id, recovery_grant_id: snapshot.value.grant?.id });

// setup runs before any child renderer mounts and reports success.
const stopReady = onVisibleDiagramReady(() => host.value, (macroType: MacroTypeValue) => {
  rendered = true;
  trackAnalyticsEvent('fullscreen_view_ready', { ...common(), macro_type: macroType,
    access_source: snapshot.value.state === 'unavailable' ? 'fail_open'
      : snapshot.value.state === 'disabled' ? 'existing' : 'temporary' });
  if (snapshot.value.state === 'pending_activation') void activate();
});

async function activate() {
  if (!rendered || activating.value || snapshot.value.state !== 'pending_activation' || !snapshot.value.request) return;
  activating.value = true;
  try {
    const result = await activateFullscreenRecovery({ action: 'activate', attemptId, requestId: snapshot.value.request.id, spaceKey: props.context.spaceKey! });
    if (disposed) return;
    snapshot.value = result.snapshot;
    serverClockOffset = Date.parse(result.snapshot.serverNow) - Date.now();
    activationError.value = false;
  } catch {
    if (!disposed) {
      activationError.value = true;
      trackAnalyticsEvent('fullscreen_recovery_activation_failed', { ...common(), failure_stage: 'confirmation', failure_reason: 'unavailable' });
    }
  } finally { activating.value = false; }
}

async function open() {
  openError.value = false;
  // Returning to the same mounted view must not force-close it at expiry.
  if (hasOpened.value) { showRequest.value = false; return; }
  if (!['active', 'pending_activation'].includes(snapshot.value.state)) {
    try { snapshot.value = await getFullscreenRecovery(props.context.spaceKey); }
    catch { openError.value = true; return; }
    if (disposed) return;
  }
  if (['active', 'pending_activation', 'disabled', 'unavailable'].includes(snapshot.value.state)) {
    hasOpened.value = true; showRequest.value = false;
  }
}

async function goToPlanUsage(requestId?: string, scenarios?: RecoveryScenario[]) {
  try { await props.planUsage(requestId, scenarios); }
  catch { openError.value = true; }
}

function dismissNotice() {
  dismissed.value = true;
  trackAnalyticsEvent('fullscreen_recovery_action_selected', { ...common(), recovery_action: 'dismiss_notice' });
}
onMounted(() => {
  clock = setInterval(() => {
    if (snapshot.value.state === 'active' && snapshot.value.grant?.expiresAt
      && Date.now() + serverClockOffset >= Date.parse(snapshot.value.grant.expiresAt)) {
      snapshot.value = { ...snapshot.value, state: 'expired' };
      // Intentionally leave hasOpened true; only a fresh open checks access.
    }
  }, 30_000);
});
onBeforeUnmount(() => { disposed = true; stopReady(); clearInterval(clock); });
</script>

<style scoped>
.recovery-host { min-height: 100vh; }
.recovery-content { min-height: 100vh; padding-bottom: 70px; }
.recovery-access { position: fixed; left: 16px; right: 16px; bottom: 8px; z-index: 30; pointer-events: none; }
.recovery-access :deep(aside), .recovery-access p { pointer-events: auto; }
.recovery-access p, .recovery-error { padding: 8px 12px; background: #fff; color: #1c2024; font: 14px/1.5 system-ui, sans-serif; }
.recovery-access button { margin-left: 8px; text-decoration: underline; }
</style>
