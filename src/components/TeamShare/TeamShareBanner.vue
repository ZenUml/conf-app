<template>
  <div v-if="phase !== 'hidden'" class="pb-bar">
    <span class="pb-label" :title="headline">{{ headline }}</span>

    <template v-if="manualText !== null">
      <input
        ref="manualInput"
        class="pb-input"
        readonly
        :value="manualText"
        aria-label="Message to copy"
        @focus="selectManual"
        @click="selectManual"
      />
      <span class="pb-helper">Press Ctrl/Cmd+C to copy</span>
    </template>

    <template v-else>
      <button
        class="pb-primary"
        :class="{ 'pb-primary-done': copied === 'message' }"
        @click="copy('message')"
      >{{ copied === 'message' ? 'Copied ✓' : 'Copy message' }}</button>
      <button class="pb-link pb-link-brand" @click="copy('link')">
        {{ copied === 'link' ? 'Link copied ✓' : 'Copy link' }}
      </button>
      <span v-if="copied === 'message'" class="pb-helper">Paste it in Slack, Teams or email.</span>
    </template>

    <span class="pb-spacer" />
    <button class="pb-link" @click="notNow">Not now</button>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { view } from '@forge/bridge';
import globals from '@/model/globals';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';
import type { MacroTypeValue } from '@/utils/analytics/catalog';
import { clearCsatPending } from '@/utils/csat';
import {
  clearTeamSharePending,
  isTeamSharePendingNow,
  markTeamShareShown,
  readTeamSharePending,
  siteCountBucket,
  usableDiagramTitle,
} from '@/utils/teamShare';
import { toMacroType } from '@/utils/byline/pageDiagrams';
import { writeClipboardWithMethod } from '@/composables/agentLink/clipboard';

/** The strip closes itself this long after a copy. */
const AUTO_CLOSE_MS = 5000;

/**
 * `preview` skips the gate, the requests and the analytics: Storybook and unit
 * tests hand in what the banner would have fetched.
 */
const props = defineProps<{
  preview?: { pageTitle: string; pageUrl: string; diagramTitle: string; diagramType?: string };
}>();

type Phase = 'hidden' | 'ready';
const phase = ref<Phase>('hidden');
const copied = ref<'message' | 'link' | null>(null);
/** Both clipboard paths failed: the text is shown for a manual copy. */
const manualText = ref<string | null>(null);
const manualInput = ref<HTMLInputElement | null>(null);

const pageTitle = ref('');
const pageUrl = ref('');
const diagramTitle = ref('');
/** "Mermaid diagram" etc.; names the diagram when it has no usable title. */
const typeLabel = ref('diagram');
let analyticsProps: Record<string, unknown> | null = null;
let closeTimer: ReturnType<typeof setTimeout> | null = null;

const headline = computed(() =>
  diagramTitle.value
    ? `Nice — "${diagramTitle.value}" is on this page. Share it with your team?`
    : `Nice — your ${typeLabel.value} is on this page. Share it with your team?`,
);

function buildMessage(): string {
  const first = diagramTitle.value
    ? `I made a diagram on "${pageTitle.value}": ${diagramTitle.value}.`
    : `I made ${article(typeLabel.value)} ${typeLabel.value} on "${pageTitle.value}".`;
  return [
    first,
    `Take a look: ${pageUrl.value}`,
    'Want one on your page? Edit it, type /zenuml, and pick a diagram type.',
  ].join('\n');
}

const TYPE_LABELS: Record<string, string> = {
  sequence: 'sequence diagram',
  mermaid: 'Mermaid diagram',
  plantuml: 'PlantUML diagram',
  graph: 'draw.io diagram',
  openapi: 'API spec',
  markdown: 'Markdown block',
};

function article(label: string): string {
  return /^[aeiou]/i.test(label) ? 'an' : 'a';
}

function closeFrame() {
  try {
    view.close();
  } catch (e) {
    console.warn('[team-share] close failed', e);
  }
}

function track(name: 'team_share_prompt_shown' | 'team_share_copied' | 'team_share_dismissed', extra: Record<string, unknown> = {}) {
  if (!analyticsProps) return;
  // Counts and kinds only: never a page or diagram title, a URL or the message.
  trackAnalyticsEvent(name, { feature_area: 'team_share', surface: 'page_banner', ...analyticsProps, ...extra } as never);
}

onMounted(async () => {
  // The pageBanner mounts on every page. Any failure must end in view.close(),
  // never a stranded empty frame.
  try {
    if (props.preview) {
      pageTitle.value = props.preview.pageTitle;
      pageUrl.value = props.preview.pageUrl;
      diagramTitle.value = usableDiagramTitle(props.preview.diagramTitle);
      typeLabel.value = TYPE_LABELS[String(props.preview.diagramType || '').toLowerCase()] || 'diagram';
      phase.value = 'ready';
      return;
    }

    if (!isTeamSharePendingNow()) {
      closeFrame();
      return;
    }
    const pending = readTeamSharePending();
    if (!pending) {
      closeFrame();
      return;
    }

    const apWrapper = globals.apWrapper;
    const [page, body] = await Promise.all([
      apWrapper.getPageTitleAndUrl(pending.pageId),
      pending.contentId
        ? apWrapper.getDiagramBodyInfo(pending.contentId).catch(() => ({ title: '', diagramType: '' }))
        : Promise.resolve({ title: '', diagramType: '' }),
    ]);
    if (!page.title.trim() || !page.url) {
      closeFrame();
      return;
    }

    pageTitle.value = page.title;
    pageUrl.value = page.url;
    diagramTitle.value = usableDiagramTitle(body.title) || usableDiagramTitle(pending.diagramTitle);
    typeLabel.value = TYPE_LABELS[String(body.diagramType || '').toLowerCase()] || 'diagram';
    analyticsProps = {
      macro_type: toMacroType(body.diagramType) as MacroTypeValue,
      has_diagram_title: !!diagramTitle.value,
      site_diagram_count_bucket: siteCountBucket(pending.siteDiagramCount),
    };

    // Committed to showing: consume the trigger and the one-time record, and
    // leave the CSAT survey for a later save.
    clearTeamSharePending();
    clearCsatPending();
    markTeamShareShown();
    phase.value = 'ready';
    track('team_share_prompt_shown');
  } catch (e) {
    console.warn('[team-share] banner mount failed; closing', e);
    closeFrame();
  }
});

onBeforeUnmount(() => {
  if (closeTimer) clearTimeout(closeTimer);
});

function scheduleClose() {
  if (closeTimer) clearTimeout(closeTimer);
  closeTimer = setTimeout(closeFrame, AUTO_CLOSE_MS);
}

async function copy(kind: 'message' | 'link') {
  const text = kind === 'message' ? buildMessage() : pageUrl.value;
  const method = await writeClipboardWithMethod(text);
  if (!method) {
    // Reported when the fallback is shown: the person still has to press the
    // keys, so this counts the attempt, not a confirmed copy.
    manualText.value = text;
    track('team_share_copied', { copy_kind: kind, copy_method: 'manual_fallback' });
    await nextTick();
    manualInput.value?.focus();
    manualInput.value?.select();
    return;
  }
  copied.value = kind;
  track('team_share_copied', { copy_kind: kind, copy_method: method });
  scheduleClose();
}

function selectManual(e: Event) {
  (e.target as HTMLInputElement).select();
}

function notNow() {
  track('team_share_dismissed', { dismiss_kind: 'not_now' });
  closeFrame();
}
</script>

<style scoped>
.pb-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 20px;
  background: #F7F8F9;
  border-bottom: 1px solid #DCDFE4;
  min-height: 46px;
  width: 100%;
  box-sizing: border-box;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif;
}

.pb-label {
  font-size: 13px;
  font-weight: 500;
  color: #44546F;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.pb-helper {
  font-size: 13px;
  color: #44546F;
  white-space: nowrap;
  flex-shrink: 0;
}

.pb-spacer {
  flex: 1;
}

.pb-primary {
  background: #0C66E4;
  color: #fff;
  border: 0;
  border-radius: 6px;
  height: 30px;
  padding: 0 12px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
  white-space: nowrap;
  flex-shrink: 0;
}

.pb-primary:hover {
  background: #0055CC;
}

.pb-primary-done,
.pb-primary-done:hover {
  background: #22A06B;
}

.pb-input {
  flex: 1;
  height: 32px;
  border: 1px solid #DCDFE4;
  border-radius: 6px;
  padding: 0 10px;
  font-size: 13px;
  color: #172B4D;
  font-family: inherit;
  outline: none;
  background: #fff;
  min-width: 0;
  max-width: 460px;
}

.pb-input:focus {
  border-color: #0C66E4;
  box-shadow: 0 0 0 2px rgba(12, 102, 228, 0.13);
}

.pb-link {
  background: transparent;
  color: #44546F;
  border: 0;
  padding: 6px 4px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
  white-space: nowrap;
  flex-shrink: 0;
}

.pb-link:hover {
  color: #172B4D;
  text-decoration: underline;
}

.pb-link-brand {
  color: #0C66E4;
}

.pb-link-brand:hover {
  color: #0055CC;
}
</style>
