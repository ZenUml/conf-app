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
 * 开始编辑会话
 * @param macroUuid - 所属 macro 的 UUID
 * @param source - 编辑来源（dialog/macro，inline 不调用此函数）
 */
export function startEditJourney(macroUuid: string, source: 'dialog' | 'macro'): string {
  currentEditJourneyId = generateJourneyId();
  currentMacroUuid = macroUuid;
  editJourneyStartTime = Date.now();
  
  return currentEditJourneyId;
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
 * 获取编辑时长（毫秒）
 */
export function getEditJourneyDuration(): number | null {
  return editJourneyStartTime ? Date.now() - editJourneyStartTime : null;
}

/**
 * 结束编辑会话
 * @param reason - 结束原因：saved（保存）, cancelled（取消）, window_close（窗口关闭）
 */
export function endEditJourney(reason: 'saved' | 'cancelled' | 'window_close'): void {
  if (!currentEditJourneyId) return;
  
  currentEditJourneyId = null;
  currentMacroUuid = null;
  editJourneyStartTime = null;
}

/**
 * 接收从其他 iframe 传递的 journey ID
 * 用于 dialog 场景：viewer iframe → dialog iframe
 * @param journeyId - 从父 iframe 传递的 journey ID
 * @param macroUuid - macro UUID
 * @param startTime - 父 iframe 中的开始时间戳（可选，如果不提供则使用当前时间）
 */
export function continueEditJourney(journeyId: string, macroUuid: string, startTime?: number): void {
  currentEditJourneyId = journeyId;
  currentMacroUuid = macroUuid;
  editJourneyStartTime = startTime || Date.now();
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

/**
 * 获取 session 年龄（从创建到现在的毫秒数）
 */
export function getSessionAge(): number | null {
  const stored = sessionStorage.getItem(SESSION_KEY);
  if (!stored) return null;
  
  try {
    const data = JSON.parse(stored);
    return Date.now() - data.timestamp;
  } catch {
    return null;
  }
}

