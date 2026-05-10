import { getPresetById } from '@/sandbox/presets';

const global = {
  isForge: true,
  forgeContext: undefined,
  view: undefined,
  zenumlRemoteBaseUrl: undefined,
  isLite: undefined,
  isDiagramly: undefined,
} as any;

const REMOTE_BASE_URL_MAP = {
  DEVELOPMENT_LITE: 'https://confluence-plugin.pages.dev',
  STAGING_LITE: 'https://conf-stg-lite.zenuml.com',
  PRODUCTION_LITE: 'https://conf-lite.zenuml.com',
  DEVELOPMENT_FULL: 'https://confluence-plugin.pages.dev',
  STAGING_FULL: 'https://conf-stg-full.zenuml.com',
  PRODUCTION_FULL: 'https://conf-full.zenuml.com',
};

function isStandaloneEnvironment(): boolean {
  try {
    return typeof window !== 'undefined' && window.self === window.top;
  } catch {
    return false;
  }
}

const STANDALONE_VIEW_STUB = {
  submit: async (options: any) => {
    console.log('[standalone] view.submit() – no-op in local dev', options);
  },
  close: async () => {
    console.log('[standalone] view.close() – reloading page in local dev');
    window.location.reload();
  },
};

/**
 * Sandbox presets with `paywall: true` auto-populate the localStorage knobs
 * that useCustomerSuccessService reads, so opening one of the Paywall cards
 * lands directly on a blocked editor with the advocacy modal on top.
 */
function applyPaywallSandboxMocks(): void {
  try {
    if (!localStorage.getItem('mockMacroCount')) localStorage.setItem('mockMacroCount', '105');
    if (!localStorage.getItem('mockCSSEnabled')) localStorage.setItem('mockCSSEnabled', 'true');
    if (!localStorage.getItem('mockSpacePaid')) localStorage.setItem('mockSpacePaid', 'false');
    if (!localStorage.getItem('mockSpaceKey')) localStorage.setItem('mockSpaceKey', 'SD');
    if (!localStorage.getItem('mockClientDomain')) localStorage.setItem('mockClientDomain', 'lite-stg');
  } catch {
    // localStorage unavailable in sandboxed iframe — non-fatal, mocks stay unset.
  }
}

function getStandaloneContext(): any {
  const sandboxId = new URLSearchParams(window.location.search).get('sandbox');
  if (sandboxId) {
    const preset = getPresetById(sandboxId);
    if (preset) {
      if (preset.paywall) applyPaywallSandboxMocks();
      const isEditor = preset.macroMode === 'editor';
      return {
        extension: {
          type: 'standalone',
          content: { id: 'local-dev-page' },
          config: { uuid: 'local-dev-uuid', customContentId: preset.customContentId },
          // In a real Forge page macro, extension.modal is only set when the app is opened
          // as a dialog (editor). Viewer mode has no modal — isDisplayMode() checks for this.
          modal: isEditor ? { macroMode: preset.macroMode, diagramType: preset.diagramType } : undefined,
          macro: { isConfiguring: isEditor, isInserting: false },
        },
        moduleKey: preset.moduleKey,
        environmentType: 'DEVELOPMENT',
        localId: undefined,
        license: undefined,
      };
    }
    console.warn(`[sandbox] Unknown preset "${sandboxId}", falling back to defaults`);
  }

  return {
    extension: {
      type: 'standalone',
      content: { id: 'local-dev-page' },
      config: { uuid: 'local-dev-uuid', customContentId: undefined },
      modal: { macroMode: 'editor', diagramType: 'sequence' },
      macro: { isConfiguring: true, isInserting: false },
    },
    moduleKey: 'zenuml-sequence-macro',
    environmentType: 'DEVELOPMENT',
    localId: undefined,
    license: undefined,
  };
}

function applyStandaloneContext() {
  global.isForge = false;
  global.view = STANDALONE_VIEW_STUB;
  global.forgeContext = getStandaloneContext();
  global.isDiagramly = import.meta.env.PRODUCT_TYPE === 'diagramly';
  global.isLite = import.meta.env.PRODUCT_TYPE === 'lite';
  const urlVariant = (global.isLite || global.isDiagramly) ? 'LITE' : 'FULL';
  global.zenumlRemoteBaseUrl = REMOTE_BASE_URL_MAP[`DEVELOPMENT_${urlVariant}`];
  console.log('forgeGlobal - standalone (local dev), no Forge bridge');
  console.debug('forgeGlobal - zenumlRemoteBaseUrl', global.zenumlRemoteBaseUrl);
}

export async function getView() {
  if (global.view !== undefined) {
    return global.view;
  }
  try {
    const { view } = await import("@forge/bridge");
    const ctx = await view.getContext();
    if (!ctx?.extension && isStandaloneEnvironment()) {
      applyStandaloneContext();
      return STANDALONE_VIEW_STUB;
    }
    if (!ctx?.extension) {
      throw new Error('Forge context missing extension');
    }
    global.isForge = true;
    global.view = view;
    global.forgeContext = ctx;
    global.isDiagramly = import.meta.env.PRODUCT_TYPE === 'diagramly';
    global.isLite = import.meta.env.PRODUCT_TYPE === 'lite';
    const urlVariant = (global.isLite || global.isDiagramly) ? 'LITE' : 'FULL';
    global.zenumlRemoteBaseUrl = REMOTE_BASE_URL_MAP[`${ctx.environmentType}_${urlVariant}`];
    console.log('forgeGlobal - context', global.forgeContext);
    console.debug('forgeGlobal - zenumlRemoteBaseUrl', global.zenumlRemoteBaseUrl);
  } catch (e) {
    if (isStandaloneEnvironment()) {
      applyStandaloneContext();
      return STANDALONE_VIEW_STUB;
    }
    throw e;
  }
  return global.view;
}

export async function getContext() {
  if(!global.forgeContext) {
    await getView();
  }
  return global.forgeContext;
}

export async function isEditorMode() {
  const context = await getContext();
  return context.extension.modal?.macroMode === 'editor' || context.extension?.macro?.isConfiguring;
}

export async function isFullscreenMode() {
  const context = await getContext();
  return context.extension.modal?.macroMode === 'fullscreen';
}

// Pass `size: 'fullscreen'` to fill the viewport (100vw × 100vh, no Confluence chrome).
// GA'd Apr 28 2026 (FRGE-557 / CHANGE-3163). Atlassian-enforced header (~50px, app icon + title + X) is unavoidable.
export async function openModal(_options: any) {
  const { Modal } = await import("@forge/bridge");
  const modal = new Modal(_options);
  modal.open();
}

export async function isInserting() {
  const context = await getContext();
  return context.extension?.macro?.isInserting;
}

export async function isConfiguring() {
  const context = await getContext();
  return context.extension?.macro?.isConfiguring;
}

export async function openUrl(url: string) {
  if (global.isForge) {
    const { router } = await import("@forge/bridge");
    router.open(url);
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

// @ts-ignore
window.forgeGlobal = global;

export default global;
