import ApWrapper2 from '@/model/ApWrapper2';
import forgeGlobal from '@/model/globals/forgeGlobal';
import { LocationTarget } from '@/model/ILocationContext';

export interface EditMode {
  source: 'inline' | 'dialog' | 'macro' | 'unknown';
  page_mode: 'view' | 'edit' | 'unknown';
}

/**
 * 检测当前编辑模式
 * 
 * 检测策略：
 * - Forge: 使用 forgeContext.extension 属性判断
 * - Connect: 优先使用 LocationTarget，然后结合 URL 判断
 * - 失败时返回 'unknown'，不抛出异常（Analytics 不应阻碍用户操作）
 */
export async function detectEditMode(apWrapper: ApWrapper2): Promise<EditMode> {
  try {
    if (forgeGlobal.isForge) {
      return detectForgeMode();
    } else {
      return await detectConnectMode(apWrapper);
    }
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

/**
 * Connect 模式检测
 * 
 * 策略：
 * 1. 第一层分支：使用 LocationTarget（最可靠）
 * 2. 第二层：在 ContentView 时，通过 URL 区分 inline/dialog
 */
async function detectConnectMode(apWrapper: ApWrapper2): Promise<EditMode> {
  const href = window.location.href;
  
  try {
    // 获取 LocationTarget
    const locationTarget = await apWrapper._getLocationTarget();
    
    // ===== 第一层分支: LocationTarget =====
    
    if (locationTarget === LocationTarget.ContentView) {
      // View 模式 - 可能是 inline 或 dialog
      
      // 检查是否为 Sequence viewer（唯一支持 inline edit）
      if (href.includes('sequence-viewer.html')) {
        return { source: 'inline', page_mode: 'view' };
      }
      
      // 其他情况都是 dialog
      // 包括：sequence-viewer-dialog.html, graph-viewer-dialog.html, 
      //       swagger-ui.html (viewer), 等
      return { source: 'dialog', page_mode: 'view' };
    }
    
    if (locationTarget === LocationTarget.ContentEdit || 
        locationTarget === LocationTarget.ContentCreate) {
      // Edit 模式 - macro editor
      // 包括：所有类型的 -editor.html 在 Page Edit 模式下
      return { source: 'macro', page_mode: 'edit' };
    }
    
    // LocationTarget 是意外值
    console.error('[EditMode] Unexpected LocationTarget:', locationTarget);
    return { source: 'unknown', page_mode: 'unknown' };
    
  } catch (error) {
    // LocationTarget 获取失败
    console.error('[EditMode] Failed to get LocationTarget:', error);
    return { source: 'unknown', page_mode: 'unknown' };
  }
}

