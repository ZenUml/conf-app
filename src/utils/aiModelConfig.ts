export const DEFAULT_AI_CHAT_MODEL = 'openai/gpt-5.6-luna';
export const DEFAULT_AI_REPAIR_MODEL = 'openai/gpt-5.6-luna';
export const AI_REPAIR_RETRY_MODEL = 'anthropic/claude-sonnet-5';

export const AI_CHAT_MODEL_STORAGE_KEY = 'ai_chat_model';
export const AI_REPAIR_MODEL_STORAGE_KEY = 'ai_repair_model';

/**
 * Resolve a conf-app model override without making localStorage availability a
 * prerequisite for AI features inside restrictive Forge iframe contexts.
 */
export function resolveConfiguredAiModel(
  storageKey: string,
  fallback?: string,
): string | undefined {
  try {
    const storedModel = window.localStorage.getItem(storageKey)?.trim();
    if (storedModel) return storedModel;
  } catch {
    // Fall through to the source-controlled conf-app default/prop.
  }

  return fallback?.trim() || undefined;
}
