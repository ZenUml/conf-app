<template>
  <div
    v-if="showDialog"
    class="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4"
    data-testid="ai-repair-dialog-overlay"
    @click="closeDialog"
  >
    <div
      class="bg-white rounded-lg shadow-xl w-full max-w-7xl h-[85vh] flex flex-col border border-gray-200 overflow-hidden"
      data-testid="ai-repair-dialog-content"
      @click.stop
    >
      <div class="flex justify-between items-center px-6 py-4 border-b border-gray-200 bg-gray-50">
        <h3 class="text-lg font-semibold text-gray-800 flex items-center gap-2">
          AI Repair
        </h3>
        <button
          @click="closeDialog"
          class="text-gray-500 hover:text-gray-800 transition-colors p-1 hover:bg-gray-100 rounded"
        >
          <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>

      <div class="flex-1 overflow-hidden p-4 bg-gray-50 flex flex-col">
        <div v-if="!originalCode || !repairResult" class="flex-1 flex flex-col items-center justify-center text-gray-500">
          <div class="inline-block h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600 mb-4"></div>
          <p>{{ repairStatus || 'Analyzing changes...' }}</p>
          <div v-if="repairProgress > 0" class="mt-2 w-64 bg-gray-200 rounded-full h-2">
            <div class="bg-blue-600 h-2 rounded-full transition-all duration-300" :style="{ width: repairProgress + '%' }"></div>
          </div>
        </div>

        <div v-else class="flex-1 flex border border-gray-700 rounded-md overflow-hidden bg-gray-950 font-mono text-sm relative">

          <div class="flex-1 flex flex-col border-r border-gray-800 min-w-0">
             <div class="sticky top-0 z-10 bg-gray-800/90 backdrop-blur px-4 py-2 border-b border-gray-700 text-xs font-bold text-red-400 uppercase tracking-wider">
              <span>Original</span>
            </div>
            <div
              ref="leftScrollRef"
              class="flex-1 overflow-auto scrollbar-hide"
              @scroll="syncScroll($event, 'left')"
            >
              <div class="min-w-fit">
                <div
                  v-for="(row, idx) in diffRows"
                  :key="'left-'+idx"
                  class="flex h-6 hover:bg-gray-800/30 transition-colors"
                  :class="[row.left.type === 'removed' ? 'bg-red-900/30' : '', row.left.type === 'empty' ? 'bg-transparent' : '']"
                >
                  <div class="w-12 flex-shrink-0 text-right pr-3 text-gray-600 border-r border-gray-800 select-none leading-6 text-xs">
                    {{ row.left.lineNumber > 0 ? row.left.lineNumber : '' }}
                  </div>
                  <div class="px-4 leading-6 whitespace-pre text-gray-300" :class="{'text-gray-500 opacity-70': row.left.type === 'removed'}">
                    {{ row.left.content }}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="flex-1 flex flex-col min-w-0 relative">
            <div class="sticky top-0 z-10 bg-gray-800/90 backdrop-blur px-4 py-2 border-b border-gray-700 text-xs font-bold text-green-400 uppercase tracking-wider shrink-0">
              <span>Repaired (Editable)</span>
            </div>

            <div class="flex-1 relative overflow-hidden">
              <div
                ref="rightScrollRef"
                class="absolute inset-0 overflow-auto scrollbar-thin"
                @scroll="syncScroll($event, 'right')"
              >
                <div class="min-w-fit">
                  <div
                    v-for="(row, idx) in diffRows"
                    :key="'right-'+idx"
                    class="flex h-6 transition-colors group"
                    :class="[getRightRowClass(row), row.isEditing ? 'bg-gray-700' : 'hover:bg-gray-800/50']"
                  >
                    <div class="w-8 flex-shrink-0 flex items-center justify-center border-r border-gray-800 bg-gray-900/50">
                      <input
                        v-if="row.hasChange"
                        type="checkbox"
                        :checked="row.accepted"
                        @change="toggleAccept(row, $event)"
                        class="cursor-pointer accent-blue-500 opacity-50 group-hover:opacity-100 transition-opacity w-3.5 h-3.5"
                        title="Toggle line application"
                      />
                    </div>

                    <div class="w-12 flex-shrink-0 text-right pr-3 text-gray-600 border-r border-gray-800 select-none leading-6 text-xs">
                      {{ row.right.lineNumber > 0 ? row.right.lineNumber : '' }}
                    </div>

                    <div
                      class="flex-1 pl-4 pr-12 leading-6 whitespace-pre relative flex items-center"
                      :class="getRightContentClass(row)"
                      @dblclick="startEdit(row)"
                      title="Double click to edit"
                    >
                      <input
                        v-if="row.isEditing"
                        v-model="row.editBuffer"
                        @blur="commitEdit(row)"
                        @keyup.enter="commitEdit(row)"
                        class="absolute inset-y-0 left-0 w-full h-full bg-gray-700 text-white px-4 outline-none border-y border-blue-500 font-mono text-sm leading-6 z-10"
                        v-focus
                      />
                      <span v-else>{{ displayContent(row) }}</span>

                      <span v-if="!row.isEditing && row.customContent !== null" class="absolute left-0 text-[10px] text-blue-400 opacity-70 select-none pointer-events-none">
                        E
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div
              ref="minimapRef"
              class="absolute right-0 top-0 bottom-0 w-10 z-20 bg-gray-900/80 border-l border-gray-800 flex flex-col select-none overflow-hidden backdrop-blur-[1px]"
              :class="isDragging ? 'cursor-grabbing' : 'cursor-pointer'"
              @mousedown="handleDragStart"
            >
              <div class="flex-1 relative w-full opacity-80 hover:opacity-100 transition-opacity">
                <div
                  v-for="(row, idx) in diffRows"
                  :key="'mini-'+idx"
                  class="w-full flex"
                  :style="{ height: (100 / diffRows.length) + '%' }"
                >
                  <div
                    class="flex-1"
                    :class="row.left.type === 'removed' ? 'bg-red-500' : ''"
                  ></div>
                  <div
                    class="flex-1"
                    :class="row.right.type === 'added' ? 'bg-green-500' : ''"
                  ></div>
                </div>

                <div
                  class="absolute left-0 w-full bg-blue-500/30 border-y border-blue-400/60 pointer-events-none"
                  :style="viewportStyle"
                ></div>
              </div>
            </div>

          </div>
        </div>
      </div>

      <div class="p-4 border-t border-gray-200 bg-gray-50 flex justify-end gap-3">
        <button @click="closeDialog" class="px-5 py-2 rounded-md text-gray-600 hover:bg-gray-100 hover:text-gray-800 transition-all font-medium text-sm">
          Discard
        </button>
        <button
          @click="applyRepair"
          :disabled="!repairResult"
          class="px-5 py-2 rounded-md bg-blue-600 hover:bg-blue-500 text-white shadow transition-all font-medium text-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <span>Apply Code</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed, nextTick, onUnmounted, onBeforeUnmount, Directive } from 'vue';
import * as Diff from 'diff';
import { startFixDiagram, getFixDiagramStatus } from "@/services/GenerateService";
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';
import type { MacroTypeValue } from '@/utils/analytics/catalog';

const props = defineProps({
  showDialog: Boolean,
  originalCode: String,
  diagramType: Object,
  error: [String, Object],
  model: {
    type: String,
    default: 'openai/gpt-5.6-luna',
  },
  disableReasoning: {
    type: Boolean,
    default: undefined,
  },
});

const emit = defineEmits(['close', 'apply']);

// Custom directive: auto-focus input on double-click
const vFocus: Directive = {
  mounted: (el) => el.focus()
};

// Type definitions
interface DiffLine {
  content: string;
  lineNumber: number;
  type: 'common' | 'added' | 'removed' | 'empty';
}

interface DiffRow {
  left: DiffLine;
  right: DiffLine;
  hasChange: boolean;
  accepted: boolean;      // Whether to apply changes to this line
  isEditing: boolean;     // Whether currently editing
  editBuffer: string;     // Edit temporary buffer
  customContent: string | null; // Value to apply after editing
}

const repairResult = ref<string | null>(null);
const diffRows = ref<DiffRow[]>([]);

const leftScrollRef = ref<HTMLElement | null>(null);
const rightScrollRef = ref<HTMLElement | null>(null);
const minimapRef = ref<HTMLElement | null>(null);

const scrollProgress = ref(0);
const scrollVisibleRatio = ref(0);
const isDragging = ref(false);
let isSyncing = false;

// Build interactive diff data
const buildDiffRows = () => {
  if (!props.originalCode || !repairResult.value) {
    diffRows.value = [];
    return;
  }

  const diffParts = Diff.diffLines(props.originalCode, repairResult.value);
  const rows: DiffRow[] = [];
  let lNum = 1, rNum = 1, i = 0;

  while (i < diffParts.length) {
    const part = diffParts[i];
    const nextPart = diffParts[i + 1];

    // Replace logic (both removed and added exist)
    if (part.removed && nextPart?.added) {
      const removedLines = part.value.replace(/\n$/, '').split('\n');
      const addedLines = nextPart.value.replace(/\n$/, '').split('\n');
      const maxCount = Math.max(removedLines.length, addedLines.length);

      for (let j = 0; j < maxCount; j++) {
        const leftLine: DiffLine = j < removedLines.length ? { content: removedLines[j], lineNumber: lNum++, type: 'removed' } : { content: ' ', lineNumber: -1, type: 'empty' };
        const rightLine: DiffLine = j < addedLines.length ? { content: addedLines[j], lineNumber: rNum++, type: 'added' } : { content: ' ', lineNumber: -1, type: 'empty' };

        rows.push({ left: leftLine, right: rightLine, hasChange: true, accepted: true, isEditing: false, editBuffer: '', customContent: null });
      }
      i += 2;
    } else if (part.removed) { // Pure deletion
      part.value.replace(/\n$/, '').split('\n').forEach(line => {
        rows.push({
          left: { content: line, lineNumber: lNum++, type: 'removed' },
          right: { content: ' ', lineNumber: -1, type: 'empty' },
          hasChange: true, accepted: true, isEditing: false, editBuffer: '', customContent: null
        });
      });
      i++;
    } else if (part.added) { // Pure addition
      part.value.replace(/\n$/, '').split('\n').forEach(line => {
        rows.push({
          left: { content: ' ', lineNumber: -1, type: 'empty' },
          right: { content: line, lineNumber: rNum++, type: 'added' },
          hasChange: true, accepted: true, isEditing: false, editBuffer: '', customContent: null
        });
      });
      i++;
    } else { // Unchanged common lines
      part.value.replace(/\n$/, '').split('\n').forEach(line => {
        rows.push({
          left: { content: line, lineNumber: lNum++, type: 'common' },
          right: { content: line, lineNumber: rNum++, type: 'common' },
          hasChange: false, accepted: true, isEditing: false, editBuffer: '', customContent: null
        });
      });
      i++;
    }
  }
  diffRows.value = rows;
};

// --- Edit and interaction logic ---

// Toggle whether to accept this line's changes
const toggleAccept = (row: DiffRow, event: Event) => {
  row.accepted = (event.target as HTMLInputElement).checked;
  // If user chooses to undo (not accept), also clear their custom edited content
  if (!row.accepted) {
    row.customContent = null;
  }
};

// Controls the text content displayed on the right side
const displayContent = (row: DiffRow) => {
  if (row.customContent !== null) return row.customContent; // Show edited content
  if (!row.accepted) {
    // Under undone state: show text to be restored, or show added text with decoration
    if (row.left.type === 'removed') return row.left.content; // Originally deleted, now restored for display
    if (row.right.type === 'added') return row.right.content; // Originally added, now kept for strike-through display
  }
  return row.right.content; // Default AI output
};

// Enable inline editing
const startEdit = (row: DiffRow) => {
  row.isEditing = true;
  row.editBuffer = displayContent(row); // Send currently displayed content to edit box
};

// Confirm and submit line edit
const commitEdit = (row: DiffRow) => {
  row.isEditing = false;
  // Determine what the current baseline text is
  const baseContent = !row.accepted && row.left.type === 'removed' ? row.left.content : row.right.content;

  if (row.editBuffer !== baseContent) {
    row.customContent = row.editBuffer;
    row.accepted = true; // Has custom edits, force to active state
  } else {
    row.customContent = null;
  }
};

// Background style for rows on the right side
const getRightRowClass = (row: DiffRow) => {
  if (!row.accepted) return 'bg-gray-800/20'; // Background for undone state
  if (row.customContent !== null) return 'bg-blue-900/30'; // Background for manual modifications
  if (row.right.type === 'added') return 'bg-green-900/30'; // Background for accepted AI additions
  if (row.right.type === 'empty') return 'bg-transparent';
  return '';
};

// Right side text color and decoration styles
const getRightContentClass = (row: DiffRow) => {
  if (row.customContent !== null) return 'text-blue-300 font-medium';
  if (!row.accepted) {
    if (row.left.type === 'removed') return 'text-yellow-200/80'; // Yellow text hint: restored originally deleted text
    if (row.right.type === 'added') return 'text-gray-500 line-through opacity-70'; // Strikethrough: undo additions
  }
  if (row.right.type === 'added') return 'text-green-300 font-medium';
  return 'text-gray-200';
};

// --- Generate final code ---
const getFinalCode = () => {
  const lines: string[] = [];
  for (const row of diffRows.value) {
    // 1. If there is a custom modification, it has the highest priority
    if (row.customContent !== null) {
      lines.push(row.customContent);
      continue;
    }

    // 2. Decide based on user acceptance state
    if (row.accepted) {
      // Accept AI changes: push common content or added content (skip empty/AI-deleted rows)
      if (row.right.type === 'common' || row.right.type === 'added') {
        lines.push(row.right.content);
      }
    } else {
      // Reject AI changes: restore original content (push content that was originally deleted)
      if (row.left.type === 'common' || row.left.type === 'removed') {
        lines.push(row.left.content);
      }
    }
  }
  return lines.join('\n');
};

const applyRepair = () => {
  if (diffRows.value.length > 0) {
    const finalCode = getFinalCode();
    wasApplied.value = true;
    const hasModifiedLines = diffRows.value.some(r => r.customContent !== null);
    const hasRejectedLines = diffRows.value.some(r => r.hasChange && !r.accepted);
    trackAnalyticsEvent('ai_repair_applied', {
      feature_area: 'ai',
      surface: 'modal',
      macro_type: macroType.value,
      result: hasModifiedLines || hasRejectedLines ? 'applied_modified' : 'applied_as_is',
    });
    emit('apply', finalCode);
    closeDialog();
  }
};

// --- Scrolling and drag logic ---

const viewportStyle = computed(() => ({
  top: `${scrollProgress.value * 100}%`,
  height: `${scrollVisibleRatio.value * 100}%`
}));

const updateMinimapState = () => {
  if (rightScrollRef.value) {
    const el = rightScrollRef.value;
    scrollProgress.value = el.scrollTop / el.scrollHeight;
    scrollVisibleRatio.value = el.clientHeight / el.scrollHeight;
  }
};

const syncScroll = (event: Event, source: 'left' | 'right') => {
  if (isSyncing) return;
  isSyncing = true;
  const el = event.target as HTMLElement;
  const target = source === 'left' ? rightScrollRef.value : leftScrollRef.value;

  if (target) {
    target.scrollTop = el.scrollTop;
    target.scrollLeft = el.scrollLeft;
  }

  scrollProgress.value = el.scrollTop / el.scrollHeight;
  scrollVisibleRatio.value = el.clientHeight / el.scrollHeight;

  window.requestAnimationFrame(() => isSyncing = false);
};

const performScroll = (clientY: number) => {
  if (!minimapRef.value || !rightScrollRef.value) return;
  const rect = minimapRef.value.getBoundingClientRect();
  const scrollEl = rightScrollRef.value;

  let percentage = (clientY - rect.top) / rect.height;
  percentage = Math.max(0, Math.min(1, percentage));

  const targetScroll = (percentage * scrollEl.scrollHeight) - (scrollEl.clientHeight / 2);
  scrollEl.scrollTop = targetScroll;
};

const handleDragStart = (e: MouseEvent) => {
  isDragging.value = true;
  performScroll(e.clientY);
  window.addEventListener('mousemove', handleMouseMove);
  window.addEventListener('mouseup', handleDragEnd);
};

const handleMouseMove = (e: MouseEvent) => {
  if (!isDragging.value) return;
  performScroll(e.clientY);
};

const handleDragEnd = () => {
  isDragging.value = false;
  window.removeEventListener('mousemove', handleMouseMove);
  window.removeEventListener('mouseup', handleDragEnd);
};

// Trigger AI repair
const repairStatus = ref<string>('');
const repairProgress = ref<number>(0);
const currentJobId = ref<string | null>(null);
let pollIntervalId: number | null = null;
let pollingGeneration = 0;
let repairStartedAt = 0;
let pollCount = 0;
const wasApplied = ref(false);
const POLL_INTERVAL_MS = 1000;
const REPAIR_TIMEOUT_BUDGET_MS = 60_000;
const macroType = computed(
  () => (props.diagramType?.toString().toLowerCase() ?? 'none') as MacroTypeValue
);

type RepairFailurePhase = 'start' | 'poll' | 'server' | 'timeout';
type RepairJobStatus = Awaited<ReturnType<typeof getFixDiagramStatus>>;

class RepairTimeoutError extends Error {
  constructor() {
    super(`Diagram modification timed out after ${REPAIR_TIMEOUT_BUDGET_MS / 1000} seconds`);
    this.name = 'RepairTimeoutError';
  }
}

const withRepairDeadline = async <T,>(operation: () => Promise<T>, deadlineMs: number): Promise<T> => {
  const remainingMs = deadlineMs - Date.now();
  if (remainingMs <= 0) throw new RepairTimeoutError();

  let timeoutId: number | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new RepairTimeoutError()), remainingMs);
  });

  try {
    return await Promise.race([operation(), timeoutPromise]);
  } finally {
    if (timeoutId !== null) window.clearTimeout(timeoutId);
  }
};

const backendAnalytics = (status?: RepairJobStatus) => {
  const output = status?.output;
  return {
    ...(typeof output?.durationMs === 'number' ? { backend_duration_ms: output.durationMs } : {}),
    ...(typeof output?.repairAttempts === 'number' ? { repair_attempts: output.repairAttempts } : {}),
    ...(typeof output?.model === 'string' ? { ai_model: output.model } : {}),
    ...(typeof output?.reasoningDisabled === 'boolean' ? { reasoning_disabled: output.reasoningDisabled } : {}),
  };
};

const requestedConfigAnalytics = () => ({
  ...(typeof props.model === 'string' ? { ai_model: props.model } : {}),
  ...(typeof props.disableReasoning === 'boolean'
    ? { reasoning_disabled: props.disableReasoning }
    : {}),
});

const failRepair = (
  displayMessage: string,
  failureReason: string,
  failurePhase: RepairFailurePhase,
  generation: number,
  status?: RepairJobStatus,
) => {
  if (generation !== pollingGeneration) return;

  console.error('[AIRepair] Repair error:', displayMessage);
  repairResult.value = `// Error: ${displayMessage}`;
  repairStatus.value = `Error: ${displayMessage}`;
  trackAnalyticsEvent('ai_repair_failed', {
    feature_area: 'ai',
    surface: 'modal',
    macro_type: macroType.value,
    failure_reason: failureReason,
    failure_phase: failurePhase,
    duration_ms: Math.max(0, Date.now() - repairStartedAt),
    poll_interval_ms: POLL_INTERVAL_MS,
    timeout_budget_ms: REPAIR_TIMEOUT_BUDGET_MS,
    poll_count: pollCount,
    ...backendAnalytics(status),
  });
  stopPolling();
};

const triggerAiRepair = async () => {
  stopPolling();
  const generation = pollingGeneration;
  repairStartedAt = Date.now();
  pollCount = 0;
  const deadlineMs = repairStartedAt + REPAIR_TIMEOUT_BUDGET_MS;

  try {
    repairStatus.value = 'Starting AI repair...';
    repairProgress.value = 0;
    trackAnalyticsEvent('ai_repair_requested', {
      feature_area: 'ai',
      surface: 'modal',
      macro_type: macroType.value,
      prompt_length: (props.originalCode || '').length,
      poll_interval_ms: POLL_INTERVAL_MS,
      timeout_budget_ms: REPAIR_TIMEOUT_BUDGET_MS,
      ...requestedConfigAnalytics(),
    });

    const { jobId } = await withRepairDeadline(
      () => startFixDiagram(
        props.originalCode || '',
        props.error?.toString() || 'Syntax error',
        props.diagramType,
        {
          ...(props.model !== undefined ? { model: props.model } : {}),
          ...(props.disableReasoning !== undefined
            ? { disableReasoning: props.disableReasoning }
            : {}),
        },
      ),
      deadlineMs,
    );

    if (generation !== pollingGeneration || !props.showDialog) return;
    currentJobId.value = jobId;
    startPolling(jobId, generation, deadlineMs);

  } catch (err: any) {
    const timedOut = err instanceof RepairTimeoutError;
    failRepair(
      err.message,
      timedOut ? 'client_timeout' : 'start_failed',
      timedOut ? 'timeout' : 'start',
      generation,
    );
  }
};

const startPolling = (jobId: string, generation: number, deadlineMs: number) => {
  const poll = async () => {
    if (generation !== pollingGeneration) return;

    try {
      pollCount++;
      const status = await withRepairDeadline(() => getFixDiagramStatus(jobId), deadlineMs);
      if (generation !== pollingGeneration) return;

      // Update UI
      repairStatus.value = status.message || status.status;
      repairProgress.value = status.progress;

      // Check completion
      if (status.status === 'COMPLETED') {
        if (status.output?.diagramCode) {
          repairResult.value = status.output.diagramCode;
          repairStatus.value = 'Completed';
          repairProgress.value = 100;
        } else {
          failRepair(
            'Job completed but no diagram code in output',
            'missing_output',
            'server',
            generation,
            status,
          );
          return;
        }
        trackAnalyticsEvent('ai_repair_succeeded', {
          feature_area: 'ai',
          surface: 'modal',
          macro_type: macroType.value,
          duration_ms: Math.max(0, Date.now() - repairStartedAt),
          poll_interval_ms: POLL_INTERVAL_MS,
          timeout_budget_ms: REPAIR_TIMEOUT_BUDGET_MS,
          poll_count: pollCount,
          ...backendAnalytics(status),
        });
        stopPolling();
        return;
      } else if (status.status === 'FAILED') {
        failRepair(
          `Diagram modification failed: ${status.error || 'Unknown error'}`,
          status.output?.timedOut ? 'server_timeout' : 'server_failed',
          status.output?.timedOut ? 'timeout' : 'server',
          generation,
          status,
        );
        return;
      }

      // Schedule next poll only after current one completes
      if (generation === pollingGeneration) {
        const remainingMs = deadlineMs - Date.now();
        if (remainingMs <= 0) throw new RepairTimeoutError();
        pollIntervalId = window.setTimeout(poll, Math.min(POLL_INTERVAL_MS, remainingMs));
      }

    } catch (err: any) {
      const timedOut = err instanceof RepairTimeoutError;
      failRepair(
        err.message,
        timedOut ? 'client_timeout' : 'poll_failed',
        timedOut ? 'timeout' : 'poll',
        generation,
      );
    }
  };

  // Start first poll
  void poll();
};

const stopPolling = () => {
  pollingGeneration++;
  if (pollIntervalId !== null) {
    window.clearTimeout(pollIntervalId);
    pollIntervalId = null;
  }
};

const closeDialog = () => {
  stopPolling();
  if (!wasApplied.value && repairResult.value !== null) {
    trackAnalyticsEvent('ai_repair_dismissed', {
      feature_area: 'ai',
      surface: 'modal',
      macro_type: macroType.value,
    });
  }
  wasApplied.value = false;
  emit('close');
  repairResult.value = null;
  diffRows.value = [];
  currentJobId.value = null;
  handleDragEnd();
};

watch(repairResult, () => {
  if (repairResult.value) {
    buildDiffRows();
    nextTick(updateMinimapState);
  }
});

watch([() => props.originalCode, () => props.showDialog], ([_code, show]) => {
  if (show && !repairResult.value) triggerAiRepair();
});

// Cleanup on unmount
onBeforeUnmount(() => {
  stopPolling();
});

onUnmounted(handleDragEnd);
</script>

<style scoped>
.scrollbar-hide::-webkit-scrollbar { display: none; }
.scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }

.scrollbar-thin::-webkit-scrollbar { width: 6px; height: 6px; }
.scrollbar-thin::-webkit-scrollbar-track { background: transparent; }
.scrollbar-thin::-webkit-scrollbar-thumb { background: #374151; border-radius: 10px; }
.scrollbar-thin::-webkit-scrollbar-thumb:hover { background: #4b5563; }
</style>
