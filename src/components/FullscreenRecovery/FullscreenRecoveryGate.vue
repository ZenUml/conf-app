<template>
  <section class="recovery" aria-labelledby="recovery-title" data-testid="fullscreen-recovery-gate">
    <div class="recovery__eyebrow">ZenUML Lite · Fullscreen</div>

    <template v-if="view === 'scenarios'">
      <h1 id="recovery-title">How will you use Fullscreen?</h1>
      <p class="recovery__lead">Tell us what you need. After your request is saved, you can use Fullscreen for 7 days starting with your first successful opening.</p>
      <fieldset class="recovery__fieldset">
        <legend>Choose one or more</legend>
        <label v-for="code in scenarioCodes" :key="code" class="recovery__choice">
          <input v-model="scenarios" type="checkbox" :value="code">
          <span>{{ scenarioLabels[code] }}</span>
        </label>
      </fieldset>
      <details class="recovery__details" :open="!!note">
        <summary>Additional context (optional)</summary>
        <label class="recovery__label" for="recovery-note">Anything that would help us understand your use</label>
        <textarea id="recovery-note" v-model="note" rows="3" maxlength="2000" />
      </details>
      <div class="recovery__actions">
        <button type="button" class="recovery__primary" :disabled="scenarios.length === 0" @click="showContact">Contact support</button>
        <button type="button" class="recovery__secondary" @click="planUsage">Plan and usage</button>
      </div>
      <button type="button" class="recovery__link" @click="close">Back to diagram</button>
    </template>

    <template v-else-if="view === 'contact'">
      <h1 id="recovery-title">Contact support</h1>
      <p class="recovery__lead">We'll reply about this Fullscreen request at the address you provide.</p>
      <div class="recovery__context">
        <strong>Included with your request</strong>
        <p>Current Confluence site, diagram reference, and your Fullscreen use.</p>
        <p>Use: {{ selectedScenarioText }}</p>
        <p v-if="note">Additional context: {{ note }}</p>
      </div>
      <form id="recovery-form" @submit.prevent="submit">
        <label class="recovery__label" for="recovery-email">Reply email</label>
        <input id="recovery-email" v-model.trim="email" type="email" autocomplete="email" inputmode="email" maxlength="254" required>
        <label class="recovery__consent">
          <input v-model="consent" type="checkbox" required>
          <span>I agree that support may use this email to reply about this request.</span>
        </label>
        <p class="recovery__subtle">A repeated request keeps the original access period.</p>
        <p v-if="error" class="recovery__error" role="alert">{{ error }}</p>
        <div class="recovery__actions">
          <button class="recovery__primary" type="submit" :disabled="busy || !canSubmit">{{ busy ? 'Saving request…' : error ? 'Retry request' : 'Submit request' }}</button>
          <button class="recovery__secondary" type="button" :disabled="busy" @click="view = 'scenarios'">Back</button>
        </div>
      </form>
      <button type="button" class="recovery__link" @click="close">Back to diagram</button>
    </template>

    <template v-else-if="view === 'ready'">
      <span class="recovery__badge">Request {{ localSnapshot.request?.id }} saved</span>
      <h1 id="recovery-title">Fullscreen is ready</h1>
      <p class="recovery__lead">Your 7 days have not started. They begin when the diagram first opens successfully in Fullscreen.</p>
      <RequestSummary :snapshot="localSnapshot" />
      <div class="recovery__actions">
        <button type="button" class="recovery__primary" @click="openFullscreen">{{ openLabel || 'Open Fullscreen' }}</button>
        <button type="button" class="recovery__secondary" @click="close">Maybe later</button>
      </div>
    </template>

    <template v-else-if="view === 'expired'">
      <h1 id="recovery-title">Your temporary Fullscreen access has ended</h1>
      <p class="recovery__lead">It ended {{ expiryText }}. You can still read the diagram on this page.</p>
      <p>Still need Fullscreen? Continue your existing request. You don't need to repeat your use case.</p>
      <div class="recovery__actions">
        <button type="button" class="recovery__primary" @click="showRequest">Continue the conversation</button>
        <button type="button" class="recovery__secondary" @click="planUsage">Plan and usage</button>
      </div>
      <button type="button" class="recovery__link" @click="close">Back to diagram</button>
    </template>

    <template v-else>
      <span class="recovery__badge">Request {{ localSnapshot.request?.id }}</span>
      <h1 id="recovery-title">Continue this request</h1>
      <RequestSummary :snapshot="localSnapshot" />
      <p v-if="localSnapshot.request?.mailState === 'queued' || !localSnapshot.request?.mailState" class="recovery__status">Your request is saved. Support has not sent a reply yet.</p>
      <p v-else-if="localSnapshot.request?.mailState === 'failed' || localSnapshot.request?.mailState === 'bounced' || localSnapshot.request?.mailState === 'delivery_unknown'" class="recovery__status">Your request is saved. We could not confirm delivery of our email. Use the request reference to contact support.</p>
      <p v-else-if="localSnapshot.request?.supportOutcome === 'customer_replied'" class="recovery__status">Your reply has been recorded. Support will confirm the next step.</p>
      <p v-else class="recovery__status">Support has sent a reply. You do not need to reply just to confirm receipt.</p>
      <p v-if="expiryText">Current access {{ localSnapshot.state === 'active' ? 'ends' : 'ended' }} {{ expiryText }}.</p>
      <p v-else>Your 7 days begin when the diagram first opens successfully in Fullscreen.</p>
      <p v-if="localSnapshot.request?.mailState === 'accepted' || localSnapshot.request?.mailState === 'delivered'">If you still need Fullscreen, reply to the original email and tell us what you need to do next. Support will review it. A reply does not automatically extend access.</p>
      <p v-else>When support replies, you can continue in the same email thread. No new request form is needed.</p>
      <p v-if="supportMailto">Can't find the email? <a :href="supportMailto">Email support</a> with reference {{ localSnapshot.request?.id }}.</p>
      <div class="recovery__actions">
        <button v-if="localSnapshot.state === 'pending_activation' || localSnapshot.state === 'active'" type="button" class="recovery__primary" @click="openFullscreen">{{ openLabel || 'Open Fullscreen' }}</button>
        <button type="button" class="recovery__secondary" @click="close">Back to diagram</button>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { FULLSCREEN_RECOVERY_POLICY_VERSION, FULLSCREEN_RECOVERY_SCENARIOS } from '../../../shared/fullscreenRecovery'
import type { RecoveryRequestInput, RecoveryResult, RecoveryScenario, RecoverySnapshot } from '../../../shared/fullscreenRecovery'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'
import { requestFullscreenRecovery } from '@/apis/fullscreenRecovery'
import RequestSummary from './RequestSummary.vue'
import { fullLocalDate, safeSupportMailto, scenarioLabels } from './recoveryPresentation'

type View = 'scenarios' | 'contact' | 'ready' | 'expired' | 'request'
const props = withDefaults(defineProps<{
  snapshot: RecoverySnapshot
  request?: (input: RecoveryRequestInput) => Promise<RecoveryResult>
  context?: Pick<RecoveryRequestInput, 'contentId' | 'customContentId' | 'spaceKey'>
  initialView?: 'request'
  initialScenarios?: RecoveryScenario[]
  openLabel?: string
  surface?: 'viewer' | 'dashboard'
}>(), { request: requestFullscreenRecovery, surface: 'viewer' })
const emit = defineEmits<{
  (event: 'update:snapshot', snapshot: RecoverySnapshot): void
  (event: 'openFullscreen'): void
  (event: 'returnInline'): void
  (event: 'planUsage', requestId?: string, scenarios?: RecoveryScenario[]): void
  (event: 'actionSelected', action: 'contact_support' | 'plan_usage' | 'back_to_inline' | 'continue_request'): void
  (event: 'requestSubmitted', input: { attemptId: string; scenarios: RecoveryScenario[]; hasNote: boolean }): void
  (event: 'requestFailed', reason: 'validation' | 'network', attemptId?: string): void
}>()

function viewForSnapshot(snapshot: RecoverySnapshot): View {
  if (props.initialView === 'request' && snapshot.request) return 'request'
  if (snapshot.state === 'expired') return 'expired'
  if (snapshot.state === 'active') return 'request'
  if (snapshot.request) return 'ready'
  return 'scenarios'
}
const localSnapshot = ref(props.snapshot)
const view = ref<View>(viewForSnapshot(props.snapshot))
watch(() => props.snapshot, (next) => { localSnapshot.value = next; view.value = viewForSnapshot(next) })

const scenarioCodes = FULLSCREEN_RECOVERY_SCENARIOS
const scenarios = ref<RecoveryScenario[]>([...new Set((props.initialScenarios || []).filter(code => FULLSCREEN_RECOVERY_SCENARIOS.includes(code)))])
const note = ref('')
const email = ref('')
const consent = ref(false)
const busy = ref(false)
const error = ref('')
const selectedScenarioText = computed(() => scenarios.value.map(code => scenarioLabels[code]).join(', '))
const canSubmit = computed(() => scenarios.value.length > 0 && email.value.length > 0 && consent.value)
const expiryText = computed(() => fullLocalDate(localSnapshot.value.grant?.expiresAt))
const supportMailto = computed(() => safeSupportMailto(localSnapshot.value))
const gateAttemptId = crypto.randomUUID()
function analyticsBase(attemptId = gateAttemptId) {
  return {
    feature_area: 'upgrade' as const, surface: props.surface, feature: 'fullscreen' as const,
    policy_version: FULLSCREEN_RECOVERY_POLICY_VERSION,
    entry_point: props.surface === 'dashboard' ? 'dashboard' as const : 'macro_toolbar' as const,
    attempt_id: attemptId, recovery_state: localSnapshot.value.state,
    recovery_request_id: localSnapshot.value.request?.id,
    recovery_grant_id: localSnapshot.value.grant?.id,
  }
}
onMounted(() => {
  if (localSnapshot.value.state === 'not_requested' || localSnapshot.value.state === 'expired') {
    void trackAnalyticsEvent('fullscreen_recovery_gate_shown', analyticsBase())
  }
})

function selectedAction(action: 'contact_support' | 'plan_usage' | 'back_to_inline' | 'continue_request') {
  void trackAnalyticsEvent('fullscreen_recovery_action_selected', { ...analyticsBase(), recovery_action: action === 'back_to_inline' ? 'return_inline' : action })
  emit('actionSelected', action)
}
function showContact() { selectedAction('contact_support'); view.value = 'contact'; error.value = '' }
function showRequest() { selectedAction('continue_request'); view.value = 'request' }
function planUsage() { selectedAction('plan_usage'); emit('planUsage', localSnapshot.value.request?.id, [...scenarios.value]) }
function close() { selectedAction('back_to_inline'); emit('returnInline') }
function openFullscreen() { emit('openFullscreen') }

async function submit() {
  if (busy.value) return
  const formValid = scenarios.value.length > 0 && email.value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value) && consent.value
  if (!formValid) {
    error.value = 'Choose a use, enter a valid reply email, and agree to a reply.'
    void trackAnalyticsEvent('fullscreen_recovery_request_failed', { ...analyticsBase(), failure_stage: 'validation', failure_reason: 'invalid_input' })
    emit('requestFailed', 'validation')
    return
  }
  const attemptId = crypto.randomUUID()
  const input: RecoveryRequestInput = {
    action: 'request', attemptId, scenarios: [...scenarios.value], note: note.value,
    email: email.value, consent: true, consentVersion: FULLSCREEN_RECOVERY_POLICY_VERSION,
    ...props.context,
  }
  busy.value = true
  error.value = ''
  emit('requestSubmitted', { attemptId, scenarios: input.scenarios, hasNote: !!note.value.trim() })
  void trackAnalyticsEvent('fullscreen_recovery_request_submitted', { ...analyticsBase(attemptId), scenario_codes: input.scenarios, has_note: !!note.value.trim() })
  try {
    const result = await props.request(input)
    if (!result.snapshot.request) throw new Error('missing request')
    localSnapshot.value = result.snapshot
    emit('update:snapshot', result.snapshot)
    view.value = result.snapshot.state === 'expired' ? 'expired' : 'ready'
  } catch {
    error.value = 'We could not save your request. Please try again.'
    void trackAnalyticsEvent('fullscreen_recovery_request_failed', { ...analyticsBase(attemptId), failure_stage: 'transport', failure_reason: 'unavailable' })
    emit('requestFailed', 'network', attemptId)
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.recovery { box-sizing: border-box; width: 680px; margin: 0 auto; padding: 28px; color: var(--slate-12, #1c2024); background: var(--slate-1, #fcfcfd); border: .5px solid var(--slate-6, #d9d9e0); font: 14px/1.6 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
.recovery h1 { margin: 8px 0; font-size: 22px; line-height: 1.35; letter-spacing: -.02em; font-weight: 650; }
.recovery p { margin: 0 0 16px; }
.recovery__eyebrow { color: var(--slate-11, #60646c); font-size: 12px; }
.recovery__lead { color: var(--slate-12, #1c2024); }
.recovery__fieldset { display: grid; gap: 8px; border: 0; padding: 14px 0; margin: 0; }
.recovery__fieldset legend { font-weight: 650; padding: 0; }
.recovery__choice { display: flex; align-items: flex-start; gap: 10px; border: .5px solid var(--slate-7, #cdced6); border-radius: 4px; padding: 10px 12px; cursor: pointer; }
.recovery__choice:hover { background: var(--slate-3, #f0f0f3); }
.recovery__choice:has(input:checked) { border-color: var(--indigo-7, #abbdf9); background: var(--indigo-3, #edf2fe); }
.recovery input[type='checkbox'] { width: 16px; height: 16px; margin: 3px 0 0; flex: 0 0 auto; accent-color: var(--indigo-9, #3e63dd); }
.recovery__details { margin: 16px 0; }
.recovery__details summary { cursor: pointer; color: var(--slate-11, #60646c); font-size: 12px; }
.recovery__label { display: block; margin: 16px 0 6px; }
.recovery textarea, .recovery input[type='email'] { box-sizing: border-box; width: 100%; padding: 9px 12px; color: var(--slate-12, #1c2024); background: var(--slate-1, #fcfcfd); border: .5px solid var(--slate-7, #cdced6); border-radius: 4px; font: inherit; }
.recovery__consent { display: flex; align-items: flex-start; gap: 8px; margin: 16px 0 6px; }
.recovery__context, .recovery__status { margin: 20px 0; padding: 12px 0; border-top: .5px solid var(--slate-6, #d9d9e0); border-bottom: .5px solid var(--slate-6, #d9d9e0); }
.recovery__context p:last-child { margin-bottom: 0; }
.recovery__subtle { color: var(--slate-11, #60646c); font-size: 12px; }
.recovery__error { color: var(--amber-12, #4f3422); background: var(--amber-2, #fefbe9); padding: 12px; }
.recovery__actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin: 24px 0 8px; }
.recovery button { min-height: 36px; padding: 7px 12px; border: .5px solid var(--slate-7, #cdced6); border-radius: 4px; background: var(--slate-3, #f0f0f3); color: var(--slate-12, #1c2024); font: inherit; cursor: pointer; }
.recovery button:hover:not(:disabled) { background: var(--slate-4, #e8e8ec); }
.recovery button:disabled { color: var(--slate-11, #60646c); background: var(--slate-3, #f0f0f3); border-color: var(--slate-6, #d9d9e0); cursor: default; }
.recovery button:focus-visible, .recovery a:focus-visible, .recovery summary:focus-visible, .recovery input:focus-visible, .recovery textarea:focus-visible { outline: 2px solid var(--indigo-8, #8da4ef); outline-offset: 3px; }
.recovery__primary { background: var(--indigo-9, #3e63dd) !important; color: var(--slate-1, #fcfcfd) !important; border-color: var(--indigo-9, #3e63dd) !important; }
.recovery__primary:hover:not(:disabled) { background: var(--indigo-10, #3358d4) !important; }
.recovery__primary:disabled { background: var(--slate-3, #f0f0f3) !important; color: var(--slate-11, #60646c) !important; border-color: var(--slate-6, #d9d9e0) !important; }
.recovery .recovery__link { border: 0; background: none; padding-left: 0; color: var(--indigo-11, #3a5bc7); }
.recovery .recovery__link:hover { background: none; text-decoration: underline; }
.recovery__badge { display: inline-block; margin: 0 0 8px; color: var(--green-11, #218358); font-size: 12px; }
.recovery a { color: var(--indigo-11, #3a5bc7); }
</style>
