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
    // 返回 unknown，不阻碍用户操作
    return { source: 'unknown', page_mode: 'unknown' };
  }
}

/**
 * Forge 模式检测
 */
function detectForgeMode(): EditMode {
  try {
    const context = forgeGlobal.forgeContext;
    
    // 1. 检查是否在 macro 配置/插入模式（Page Edit 时插入 macro）
    if (context.extension?.macro?.isConfiguring || context.extension?.macro?.isInserting) {
      return { source: 'macro', page_mode: 'edit' };
    }
    
    // 2. 检查是否在 modal 中（Dialog Edit from viewer）
    if (context.extension?.modal) {
      return { source: 'dialog', page_mode: 'view' };
    }
    
    // 3. 默认为 inline（Forge Viewer 中直接保存，仅 Sequence 支持）
    return { source: 'inline', page_mode: 'view' };
    
  } catch (error) {
    console.error('[EditMode] Forge detection failed:', error);
    return { source: 'unknown', page_mode: 'unknown' };
  }
}
