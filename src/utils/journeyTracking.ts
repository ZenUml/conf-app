import { trackAnalyticsEvent, trackAnalyticsEventBeforeUnload } from '@/utils/analytics/trackAnalyticsEvent';
import { getEditorInputSummary } from '@/utils/analytics/editorMutationTelemetry';
import type { AuthoringOutcome, MacroTypeValue, OperationMode } from '@/utils/analytics/catalog';

// ========== 通用 Journey ID 生成器 ==========

/**
 * 内部 UUID v4 生成函数
 * 避免测试环境的模块导入问题
 */
function _uuidv4(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * 统一的 journey ID 生成函数
 * 供 upgrade journey 和 edit journey 共用
 */
export function generateJourneyId(): string {
  return _uuidv4();
}

// ========== Edit Journey 管理（仅 dialog/macro）==========

let currentEditJourneyId: string | null = null;
let currentMacroUuid: string | null = null;
let editJourneyStartTime: number | null = null;

/**
 * What the terminal event needs to describe the session. Carried on the journey
 * rather than passed to endEditJourney, because the close paths that call it
 * (window unload, a generic exit handler) do not know the macro type.
 */
export interface EditJourneyMeta {
  macroType?: MacroTypeValue;
  operationMode?: OperationMode;
  /**
   * The Lite paywall gate blocked this session. Set by mountPaywallGate.
   *
   * Exists because the editors disagree on when macro_create_started fires
   * relative to the gate: the DSL editor defers it to the explicit "continue
   * editing" action (forgeIndex.ts, deliberate — a blocked user never started
   * authoring), while graph/openapi/embed emit it around the gate. That made
   * their completion rates non-comparable — 933 of 1,028 paywall_blocked_create
   * events in the 30d to 2026-09-04 had no matching start.
   *
   * The terminal event fires for every journey regardless, so stamping the flag
   * here makes the blocked population filterable on one event instead of a
   * macro_uuid join, without changing any editor's start-event semantics.
   */
  paywallBlocked?: boolean;
}

let currentMeta: EditJourneyMeta = {};
// Guards the terminal event against firing twice for one journey: an explicit
// endEditJourney followed by the unload fallback, or two close paths racing.
let ended = false;

/**
 * 开始编辑会话
 * @param macroUuid - 所属 macro 的 UUID
 * @param source - 编辑来源（dialog/macro，inline 不调用此函数）
 */
export function startEditJourney(
  macroUuid: string,
  source: 'dialog' | 'macro',
  meta: EditJourneyMeta = {},
): string {
  currentEditJourneyId = generateJourneyId();
  currentMacroUuid = macroUuid;
  editJourneyStartTime = Date.now();
  currentMeta = meta;
  ended = false;
  installUnloadFallback();

  return currentEditJourneyId;
}

/**
 * Merge late-resolved fields into the current journey's meta.
 *
 * The editors start their journey before `customContentId` is resolved, so
 * operationMode is not knowable at startEditJourney time. Call this once it is,
 * so macro_authoring_ended can say what kind of session ended.
 */
export function setEditJourneyMeta(meta: EditJourneyMeta): void {
  if (!currentEditJourneyId) return;
  currentMeta = { ...currentMeta, ...meta };
}

/**
 * 获取当前编辑 journey ID
 */
export function getEditJourneyId(): string | null {
  return currentEditJourneyId;
}

/**
 * 获取当前编辑 journey 开始时间戳
 * 用于跨 iframe 传递
 */
export function getEditJourneyStartTime(): number | null {
  return editJourneyStartTime;
}

/**
 * 结束编辑会话
 * @param reason - 结束原因：saved（保存）, cancelled（取消）, window_close（窗口关闭）
 */
export function endEditJourney(reason: AuthoringOutcome): void {
  emitAuthoringEnded(reason, false);
  currentEditJourneyId = null;
  currentMacroUuid = null;
  editJourneyStartTime = null;
  currentMeta = {};
}

/**
 * Emit the one terminal event for this journey. Idempotent per journey: the
 * unload fallback and an explicit endEditJourney must not both report.
 *
 * `beforeUnload` switches to the sendBeacon transport, which the browser queues
 * and delivers after teardown. Enrichment is async, so on a genuine unload the
 * event is best-effort — it is the fallback for editors with no explicit cancel
 * hook, not a substitute for one.
 */
function emitAuthoringEnded(reason: AuthoringOutcome, beforeUnload: boolean): void {
  if (!currentEditJourneyId || ended) return;
  ended = true;

  const props = {
    feature_area: 'macro' as const,
    surface: 'editor' as const,
    authoring_outcome: reason,
    journey_id: currentEditJourneyId,
    ...(editJourneyStartTime != null
      ? { authoring_duration_ms: Math.max(0, Date.now() - editJourneyStartTime) }
      : {}),
    ...(currentMeta.macroType ? { macro_type: currentMeta.macroType } : {}),
    ...(currentMeta.operationMode ? { operation_mode: currentMeta.operationMode } : {}),
    ...(currentMeta.paywallBlocked ? { paywall_blocked: true } : {}),
    ...getEditorInputSummary(),
  };

  try {
    if (beforeUnload) {
      void trackAnalyticsEventBeforeUnload('macro_authoring_ended', props);
    } else {
      trackAnalyticsEvent('macro_authoring_ended', props);
    }
  } catch (e) {
    // Telemetry must never break a close path.
    console.error('[journey] macro_authoring_ended failed', e);
  }
}

let unloadFallbackInstalled = false;

/**
 * Last-resort terminal event. `pagehide` is the reliable teardown signal inside
 * a Forge iframe (`beforeunload` is unreliable there, and `unload` is ignored
 * by bfcache-aware browsers). Installed once per iframe, no-ops when no journey
 * is open or one already reported.
 */
function installUnloadFallback(): void {
  if (unloadFallbackInstalled || typeof window === 'undefined') return;
  unloadFallbackInstalled = true;
  window.addEventListener('pagehide', () => {
    emitAuthoringEnded('window_close', true);
  });
}

/**
 * 接收从其他 iframe 传递的 journey ID
 * 用于 dialog 场景：viewer iframe → dialog iframe
 * @param journeyId - 从父 iframe 传递的 journey ID
 * @param macroUuid - macro UUID
 * @param startTime - 父 iframe 中的开始时间戳（可选，如果不提供则使用当前时间）
 */
export function continueEditJourney(
  journeyId: string,
  macroUuid: string,
  startTime?: number,
  meta: EditJourneyMeta = {},
): void {
  currentEditJourneyId = journeyId;
  currentMacroUuid = macroUuid;
  editJourneyStartTime = startTime || Date.now();
  currentMeta = meta;
  ended = false;
  installUnloadFallback();
}

// ========== Session 管理（所有场景）==========

const SESSION_KEY = 'zenuml_page_session';
const SESSION_TTL = 30 * 60 * 1000; // 30分钟

/**
 * 获取或创建页面 session ID
 * 使用 sessionStorage，同一标签页内所有 iframe 共享
 */
export function getOrCreateSession(): string {
  const stored = sessionStorage.getItem(SESSION_KEY);
  
  if (stored) {
    try {
      const data = JSON.parse(stored);
      const age = Date.now() - data.timestamp;
      
      // 未过期，刷新时间戳并返回
      if (age < SESSION_TTL) {
        data.timestamp = Date.now();
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
        return data.session_id;
      }
    } catch (e) {
      console.error('[Session] Failed to parse stored session:', e);
    }
  }
  
  // 创建新 session
  const sessionId = generateJourneyId();
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({
    session_id: sessionId,
    timestamp: Date.now()
  }));
  
  return sessionId;
}

