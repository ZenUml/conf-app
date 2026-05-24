import forgeGlobal from '@/model/globals/forgeGlobal';

export interface EditMode {
  source: 'inline' | 'dialog' | 'macro' | 'unknown';
  page_mode: 'view' | 'edit' | 'unknown';
}

/**
 * 检测当前编辑模式
 *
 * 检测策略：
 * - Forge: 使用 forgeContext.extension 属性判断
 * - 失败时返回 'unknown'，不抛出异常（Analytics 不应阻碍用户操作）
 */
export async function detectEditMode(): Promise<EditMode> {
  try {
    return detectForgeMode();
  } catch (error) {
    console.error('[EditMode] Detection failed:', error);
    return { source: 'unknown', page_mode: 'unknown' };
  }
}

function detectForgeMode(): EditMode {
  try {
    const context = forgeGlobal.forgeContext;
    if (!context?.extension) {
      return { source: 'unknown', page_mode: 'unknown' };
    }

    if (context.extension?.macro?.isConfiguring || context.extension?.macro?.isInserting) {
      return { source: 'macro', page_mode: 'edit' };
    }

    if (context.extension?.modal) {
      return { source: 'dialog', page_mode: 'view' };
    }

    return { source: 'inline', page_mode: 'view' };
  } catch (error) {
    console.error('[EditMode] Forge detection failed:', error);
    return { source: 'unknown', page_mode: 'unknown' };
  }
}
