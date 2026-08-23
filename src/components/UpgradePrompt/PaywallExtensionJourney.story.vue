<template>
  <div data-testid="paywall-extension-journey" class="min-h-screen bg-slate-100 text-slate-950">
    <header class="border-b border-slate-200 bg-white px-6 py-4">
      <div class="mx-auto flex max-w-[1440px] flex-col items-start justify-between gap-4 lg:flex-row lg:gap-6">
        <div>
          <p class="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">ZenUML Lite · review prototype</p>
          <h1 class="mt-1 text-2xl font-semibold">Seven-day extension journey</h1>
          <p class="mt-1 max-w-3xl text-sm text-slate-600">
            A complete, inert walkthrough from the paywall to temporary access, administrator outreach, and upgrade.
          </p>
        </div>
        <div data-testid="journey-inventory" class="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs">
          <p class="font-semibold text-slate-900">Implementation inventory</p>
          <p class="mt-1"><span class="font-semibold text-emerald-700">7 Implemented</span> · production components or purchase paths</p>
          <p><span class="font-semibold text-amber-700">9 Concept</span> · local fixtures, no analytics or external calls</p>
        </div>
      </div>
    </header>

    <div class="mx-auto grid max-w-[1440px] grid-cols-1 gap-5 p-3 sm:p-5 lg:grid-cols-[300px_minmax(0,1fr)]">
      <aside class="max-h-72 overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 shadow-sm lg:max-h-none lg:overflow-visible" aria-label="Journey stages">
        <div v-for="group in groupedStages" :key="group.label" class="mb-4 last:mb-0">
          <h2 class="mb-1.5 px-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">{{ group.label }}</h2>
          <div class="space-y-1">
            <button
              v-for="stage in group.stages"
              :key="stage.id"
              type="button"
              :data-testid="`journey-stage-${stage.id}`"
              :aria-current="stage.id === selectedStage.id ? 'step' : undefined"
              class="flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-xs transition"
              :class="stage.id === selectedStage.id ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'"
              @click="selectStage(stage.id)"
            >
              <span class="font-medium">{{ stage.title }}</span>
              <span
                class="rounded-full px-2 py-0.5 text-[10px] font-bold"
                :class="stage.status === 'Implemented'
                  ? stage.id === selectedStage.id ? 'bg-emerald-300 text-emerald-950' : 'bg-emerald-100 text-emerald-800'
                  : stage.id === selectedStage.id ? 'bg-amber-300 text-amber-950' : 'bg-amber-100 text-amber-800'"
              >{{ stage.status }}</span>
            </button>
          </div>
        </div>
      </aside>

      <main class="min-w-0">
        <section class="mb-4 flex flex-col items-start justify-between gap-2 rounded-xl border border-slate-200 bg-white px-5 py-3 shadow-sm sm:flex-row sm:items-center sm:gap-4">
          <div>
            <p class="text-xs font-semibold text-slate-500">{{ selectedStage.group }}</p>
            <div class="mt-0.5 flex items-center gap-2">
              <h2 data-testid="journey-stage-title" class="text-lg font-semibold">{{ selectedStage.title }}</h2>
              <span
                data-testid="journey-stage-status"
                class="rounded-full px-2 py-0.5 text-[10px] font-bold"
                :class="selectedStage.status === 'Implemented' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'"
              >{{ selectedStage.status }}</span>
            </div>
            <p class="mt-0.5 text-xs text-slate-600">{{ selectedStage.note }}</p>
          </div>
          <p data-testid="journey-progress" class="shrink-0 text-xs font-semibold text-slate-500">
            {{ selectedIndex + 1 }} / {{ stages.length }}
          </p>
        </section>

        <section data-testid="journey-stage-canvas" class="relative min-h-[590px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div v-if="selectedStage.id === 'warning'" class="p-8">
            <div class="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5">
              <p class="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Confluence page banner</p>
              <PaywallWarningBanner />
              <div class="mt-6 rounded-lg bg-white p-5 text-sm text-slate-500 shadow-sm">
                Existing page content remains available below the warning.
              </div>
            </div>
          </div>

          <UpgradePrompt
            v-else-if="isUpgradePromptStage"
            :visible="true"
            :macros-created="105"
            :macros-limit="100"
            upgrade-url="https://marketplace.example/upgrade?domain=example-tenant"
            enterprise-bundle-url="https://checkout.example/space-bundle"
            macro-kind="mermaid"
            action-type="page_editor"
            :remaining-continue-attempts="selectedStage.attempts"
            @close="noop"
            @continue-editing="noop"
          />

          <div v-else-if="selectedStage.id === 'intake'" class="p-4 sm:p-7">
            <div class="mb-5 flex items-start justify-between gap-4">
              <div>
                <p class="text-xs font-bold uppercase tracking-[0.16em] text-blue-700">About one minute</p>
                <h3 class="mt-1 text-xl font-semibold">Get a 7-day extension</h3>
                <p class="mt-1 text-sm text-slate-600">Three short questions help us unblock you and give your administrator useful context.</p>
              </div>
              <span data-testid="extension-question-count" class="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">3 questions</span>
            </div>
            <div data-testid="extension-disclosure" class="mb-5 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950">
              Your answers do not affect whether you qualify. ZenUML may notify your organisation's registered technical or site contact with this Space, its approximate diagram count, and the scope and timing you select. Your optional product-research answer is not shared with your organisation.
            </div>
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <fieldset data-testid="extension-question" data-question-id="long_term_access" class="rounded-lg border border-slate-200 p-3">
                <legend class="px-1 text-sm font-semibold">1. What access does your team need beyond these 7 days?</legend>
                <div class="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <select v-model="answers.scope" aria-label="Requested unblock scope" class="rounded border border-slate-300 bg-white px-3 py-2 text-sm">
                    <option value="self">Just me, in this Space</option>
                    <option value="space">Several people in this Space</option>
                    <option value="site">Multiple Spaces across our site</option>
                    <option value="not_sure">Not sure yet</option>
                  </select>
                </div>
                <p class="mt-2 text-xs text-slate-500">Your own 7-day access is the same whichever you pick.</p>
              </fieldset>

              <fieldset data-testid="extension-question" data-question-id="urgency" class="rounded-lg border border-slate-200 p-3">
                <legend class="px-1 text-sm font-semibold">2. When do you need this diagram work done?</legend>
                <div class="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <select v-model="answers.urgency" aria-label="Urgency" class="rounded border border-slate-300 bg-white px-3 py-2 text-sm">
                    <option value="today">Today</option>
                    <option value="this_week">This week</option>
                    <option value="no_hard_deadline">No hard deadline</option>
                  </select>
                </div>
                <p class="mt-2 text-xs text-slate-500">Included in the admin message so they can prioritise.</p>
              </fieldset>

              <fieldset data-testid="extension-question" data-question-id="ai_diagram_use" class="rounded-lg border border-slate-200 p-3 sm:col-span-2">
                <legend class="px-1 text-sm font-semibold">3. Optional: do you use AI tools to create or edit diagrams?</legend>
                <select v-model="answers.aiDiagramUse" aria-label="AI diagram use" class="mt-2 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm">
                  <option value="regularly">Yes, regularly</option>
                  <option value="occasionally">Yes, occasionally</option>
                  <option value="interested">No, but I’d like to</option>
                  <option value="no">No</option>
                </select>
                <p class="mt-2 text-xs text-slate-500">Product research only. Never shared with your organisation.</p>
              </fieldset>
            </div>
            <p class="mt-4 text-xs text-slate-500">The requested scope informs the upgrade path. The first temporary grant remains limited to you in this Space.</p>
          </div>

          <div v-else-if="selectedStage.id === 'granted'" class="flex min-h-[590px] items-center justify-center bg-gradient-to-br from-emerald-50 to-white p-8">
            <div class="w-full max-w-2xl rounded-2xl border border-emerald-200 bg-white p-8 text-center shadow-sm">
              <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-2xl text-emerald-700">✓</div>
              <h3 class="mt-4 text-2xl font-semibold">Your 7-day extension is active</h3>
              <p class="mt-2 text-sm text-slate-600">Temporary editing access applies to you in Space <strong>STORY</strong>.</p>
              <div data-testid="grant-expiry" class="mx-auto mt-5 max-w-md rounded-lg bg-slate-50 px-4 py-3 text-sm">
                <p class="text-slate-500">Starts 24 Aug 2026, 09:00 AEST</p>
                <p class="mt-1 font-semibold text-slate-900">Expires 31 Aug 2026, 09:00 AEST</p>
              </div>
              <button data-testid="return-to-editor" type="button" class="mt-5 rounded-lg bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white" @click="editorReturned = true">Return to editor</button>
              <div v-if="editorReturned" data-testid="editor-returned" class="mt-5 rounded-lg border border-slate-200 bg-slate-950 p-4 text-left font-mono text-xs text-emerald-300">
                Editor reopened · sequence diagram ready
              </div>
            </div>
          </div>

          <div v-else-if="selectedStage.id === 'admin-auto'" class="p-8">
            <RouteCard tone="emerald" title="Automatic route" status="Ready for notification">
              A fresh Marketplace Technical Contact is classified as a direct customer. The user is unblocked immediately; the address stays hidden from the frontend.
            </RouteCard>
            <div class="mt-5 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
              <Fact label="Resolution" value="direct_customer" />
              <Fact label="Freshness" value="Refreshed today" />
              <Fact label="Recipient" value="Registered contact (hidden)" />
            </div>
          </div>

          <div v-else-if="selectedStage.id === 'admin-manual'" class="p-8">
            <RouteCard tone="amber" title="Manual review" status="No external email queued">
              The cached contact is missing, stale, uncertain, or associated with a partner. This never blocks the eligible user's extension.
            </RouteCard>
            <div class="mt-5 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
              <Fact label="Resolution" value="uncertain" />
              <Fact label="Reason" value="Conflicting contact signals" />
              <Fact label="Next step" value="Operator review" />
            </div>
          </div>

          <div v-else-if="selectedStage.id === 'admin-email'" class="bg-slate-100 p-3 sm:p-8">
            <div data-testid="admin-email-preview" class="mx-auto max-w-2xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div class="bg-slate-950 px-7 py-5 text-white">
                <p class="text-xs font-bold uppercase tracking-[0.16em] text-emerald-300">ZenUML for Confluence</p>
                <h3 class="mt-2 text-xl font-semibold">Your team is actively using ZenUML</h3>
              </div>
              <div class="space-y-4 px-7 py-6 text-sm leading-6 text-slate-700">
                <p>A member of your organisation needed to keep working in Space <strong>STORY</strong>, which now contains approximately <strong>105 diagrams</strong>.</p>
                <p>We granted that user temporary editing access from <strong>24 Aug</strong> until <strong>31 Aug 2026</strong> so their work could continue while your team reviews its options.</p>
                <div class="rounded-lg bg-emerald-50 p-4 text-emerald-950">
                  Unlock this Space for the whole team with the Enterprise Bundle — <strong>USD 299/year/Space</strong>.
                </div>
                <button type="button" class="rounded-lg bg-emerald-700 px-4 py-2 font-semibold text-white">Review upgrade options</button>
                <p class="text-xs text-slate-500">This Storybook preview is inert. No recipient address is loaded and no message is sent.</p>
              </div>
            </div>
          </div>

          <div v-else-if="selectedStage.id === 'reminder'" class="p-8">
            <LifecycleCard eyebrow="3 days remaining" title="Your extension ends on 31 Aug" tone="blue">
              Editing is still available. Your administrator has the Space usage and upgrade path; existing diagrams will continue to render after expiry.
            </LifecycleCard>
          </div>

          <div v-else-if="selectedStage.id === 'expired'" class="p-8">
            <LifecycleCard eyebrow="Extension expired" title="Temporary editing access has ended" tone="slate">
              Existing diagrams are safe and still render. Upgrade the Space or ask for a manual review to resume creating and editing.
            </LifecycleCard>
          </div>

          <div v-else-if="selectedStage.id === 'repeat'" class="p-8">
            <LifecycleCard eyebrow="Request received" title="A team member will review this request" tone="amber">
              The automatic 7-day extension has already been used for this user and Space. No new access is promised while the request is reviewed.
            </LifecycleCard>
          </div>

          <div v-else-if="selectedStage.id === 'activation'" class="flex min-h-[590px] items-center justify-center bg-emerald-50 p-8">
            <div class="max-w-xl rounded-2xl border border-emerald-200 bg-white p-8 text-center shadow-sm">
              <p class="text-xs font-bold uppercase tracking-[0.16em] text-emerald-700">License confirmed</p>
              <h3 class="mt-2 text-2xl font-semibold">Space STORY is unlocked</h3>
              <p class="mt-2 text-sm text-slate-600">The paid Space entitlement is active. Extension reminders stop, and the team can create and edit diagrams again.</p>
              <button type="button" class="mt-5 rounded-lg bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white">Return to editor</button>
            </div>
          </div>
        </section>

        <nav class="mt-4 flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm" aria-label="Journey controls">
          <button data-testid="journey-back" type="button" class="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40" :disabled="selectedIndex === 0" @click="back">Back</button>
          <button data-testid="journey-reset" type="button" class="text-sm font-semibold text-slate-600 hover:text-slate-900" @click="reset">Reset</button>
          <button data-testid="journey-next" type="button" class="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40" :disabled="selectedIndex === stages.length - 1" @click="next">Next</button>
        </nav>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import UpgradePrompt from './UpgradePrompt.vue'
import PaywallWarningBanner from './PaywallWarningBanner.vue'

type Status = 'Implemented' | 'Concept'
type Stage = {
  id: string
  group: string
  title: string
  status: Status
  note: string
  attempts?: number
}

const stages: Stage[] = [
  { id: 'warning', group: 'Paywall', title: 'Early warning', status: 'Implemented', note: 'The production page banner gives authors a path before editing is blocked.' },
  { id: 'paywall-3', group: 'Paywall', title: '3 continues', status: 'Implemented', note: 'The production UpgradePrompt starts with the full metered allowance.', attempts: 3 },
  { id: 'paywall-2', group: 'Paywall', title: '2 continues', status: 'Implemented', note: 'Loss-preview copy makes the approaching block explicit.', attempts: 2 },
  { id: 'paywall-1', group: 'Paywall', title: 'Last continue', status: 'Implemented', note: 'The production commitment beat replaces duplicate purchase and advocacy rails.', attempts: 1 },
  { id: 'paywall-0', group: 'Paywall', title: 'Editing paused', status: 'Implemented', note: 'Existing diagrams remain safe while new edits pause.', attempts: 0 },
  { id: 'intake', group: 'Extension intake', title: 'Three questions', status: 'Concept', note: 'Two required operational questions plus one optional AI research question, with transparent administrator-contact disclosure.' },
  { id: 'granted', group: 'Granted', title: '7-day access', status: 'Concept', note: 'A server-authoritative user + Space grant, shown here as a fixed fixture.' },
  { id: 'admin-auto', group: 'Admin outreach', title: 'Automatic route', status: 'Concept', note: 'Fresh direct-customer contacts can be notified without exposing an address.' },
  { id: 'admin-manual', group: 'Admin outreach', title: 'Manual route', status: 'Concept', note: 'Uncertain, stale, missing, or partner contacts are held for review.' },
  { id: 'admin-email', group: 'Admin outreach', title: 'Email preview', status: 'Concept', note: 'Branded active-adoption copy, rendered locally without sending.' },
  { id: 'reminder', group: 'Expiry / repeat', title: 'Expiry reminder', status: 'Concept', note: 'A bounded reminder keeps the deadline clear without promising renewal.' },
  { id: 'expired', group: 'Expiry / repeat', title: 'Expired', status: 'Concept', note: 'The paywall returns at the authoritative expiry unless paid access exists.' },
  { id: 'repeat', group: 'Expiry / repeat', title: 'Repeat request', status: 'Concept', note: 'A second request is persisted for manual review, not auto-granted.' },
  { id: 'upgrade-space', group: 'Upgrade', title: 'Unlock Space', status: 'Implemented', note: 'The production USD 299/year/Space card path is available without a site admin.', attempts: 3 },
  { id: 'upgrade-site', group: 'Upgrade', title: 'Unlock Site', status: 'Implemented', note: 'The production Marketplace path covers every Space and requires site-admin approval.', attempts: 3 },
  { id: 'activation', group: 'Upgrade', title: 'Paid activation', status: 'Concept', note: 'Success appears only after a positive paid-entitlement fixture.' },
]

const selectedId = ref(stages[0].id)
const editorReturned = ref(false)
const answers = reactive({
  scope: 'self',
  urgency: 'today',
  aiDiagramUse: 'regularly',
})

const selectedIndex = computed(() => Math.max(0, stages.findIndex((stage) => stage.id === selectedId.value)))
const selectedStage = computed(() => stages[selectedIndex.value])
const isUpgradePromptStage = computed(() => selectedStage.value.attempts !== undefined)
const groupedStages = computed(() => {
  const groups: Array<{ label: string; stages: Stage[] }> = []
  for (const stage of stages) {
    let group = groups.find((candidate) => candidate.label === stage.group)
    if (!group) {
      group = { label: stage.group, stages: [] }
      groups.push(group)
    }
    group.stages.push(stage)
  }
  return groups
})

function selectStage(id: string) {
  if (stages.some((stage) => stage.id === id)) selectedId.value = id
}

function back() {
  if (selectedIndex.value > 0) selectedId.value = stages[selectedIndex.value - 1].id
}

function next() {
  if (selectedIndex.value < stages.length - 1) selectedId.value = stages[selectedIndex.value + 1].id
}

function reset() {
  selectedId.value = stages[0].id
  editorReturned.value = false
  Object.assign(answers, {
    scope: 'self', urgency: 'today', aiDiagramUse: 'regularly',
  })
}

function noop() {}

const Fact = defineComponent({
  props: { label: { type: String, required: true }, value: { type: String, required: true } },
  setup(props) {
    return () => h('div', { class: 'rounded-lg border border-slate-200 bg-slate-50 p-4' }, [
      h('p', { class: 'text-xs font-semibold text-slate-500' }, props.label),
      h('p', { class: 'mt-1 font-semibold text-slate-900' }, props.value),
    ])
  },
})

const RouteCard = defineComponent({
  props: {
    tone: { type: String, required: true }, title: { type: String, required: true }, status: { type: String, required: true },
  },
  setup(props, { slots }) {
    return () => h('div', { class: `rounded-xl border p-6 ${props.tone === 'emerald' ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}` }, [
      h('div', { class: 'flex items-center justify-between gap-4' }, [
        h('h3', { class: 'text-xl font-semibold' }, props.title),
        h('span', { class: 'rounded-full bg-white px-3 py-1 text-xs font-semibold' }, props.status),
      ]),
      h('p', { class: 'mt-3 max-w-3xl text-sm leading-6 text-slate-700' }, slots.default?.()),
    ])
  },
})

const LifecycleCard = defineComponent({
  props: { eyebrow: { type: String, required: true }, title: { type: String, required: true }, tone: { type: String, required: true } },
  setup(props, { slots }) {
    const tones: Record<string, string> = { blue: 'border-blue-200 bg-blue-50', amber: 'border-amber-200 bg-amber-50', slate: 'border-slate-300 bg-slate-50' }
    return () => h('div', { class: `mx-auto mt-20 max-w-2xl rounded-2xl border p-8 ${tones[props.tone]}` }, [
      h('p', { class: 'text-xs font-bold uppercase tracking-[0.16em] text-slate-600' }, props.eyebrow),
      h('h3', { class: 'mt-2 text-2xl font-semibold' }, props.title),
      h('p', { class: 'mt-3 text-sm leading-6 text-slate-700' }, slots.default?.()),
    ])
  },
})

onMounted(() => document.body.classList.add('paywall-extension-journey-story'))
onBeforeUnmount(() => document.body.classList.remove('paywall-extension-journey-story'))
</script>

<style>
/* UpgradePrompt teleports to body in production. In this one Storybook journey,
   keep that real component inside the focused canvas so the navigation rail
   remains visible. No production component behavior is changed. */
body.paywall-extension-journey-story > .fixed.inset-0.z-50 {
  position: absolute !important;
  inset: 238px 20px auto 340px !important;
  height: 590px;
  min-height: 0;
  align-items: flex-start !important;
  overflow: hidden;
  padding: 0 !important;
  border-radius: 0.75rem;
}
body.paywall-extension-journey-story > .fixed.inset-0.z-50 > .fixed.inset-0 {
  position: absolute !important;
  background: rgba(15, 23, 42, 0.08) !important;
  pointer-events: none;
}
body.paywall-extension-journey-story > .fixed.inset-0.z-50 > .relative {
  margin: 18px auto;
  max-height: 554px !important;
}
</style>
