import { getPresetById } from '@/sandbox/presets';
import * as renderPerf from '@/utils/analytics/renderPerf';

const global = {
  isForge: true,
  forgeContext: undefined,
  view: undefined,
  zenumlRemoteBaseUrl: undefined,
  isLite: undefined,
  isDiagramly: undefined,
  isAsyncApi: undefined,
} as any;

// zenumlRemoteBaseUrl is the origin that `callRemote` (→ invokeRemote) targets
// for our own backend endpoints (/diagramly/*, etc). It MUST match the `connect`
// remote's baseUrl (manifest `${BACKEND_API_BASE_URL}`) for the running variant,
// or invokeRemote can't resolve a declared remote and the backend rejects the
// Forge invocation token. asyncapi shares the Lite Cloudflare Pages project but
// on its own hostnames (staging: conf-stg-lite; prod: zenapi.zenuml.com — a
// custom domain aliased to conf-lite), so it needs its own entries rather than
// reusing LITE (whose prod host is conf-lite.zenuml.com).
// DEVELOPMENT_* deliberately reuse the STAGING backends.
//
// They used to point at https://confluence-plugin.pages.dev, which NOTHING in
// CI deploys (.github/workflows only publish conf-stg-lite / conf-stg-full /
// conf-lite / conf-full). That project drifted: measured 2026-08-07 it still
// served older routes (/feature-flags 400, /api/space-status 401) but answered
// /forge-upload-attachment with 405 and no content-type — the static SPA
// handler, i.e. the path is absent from its deployed public/_routes.json. So
// every DEVELOPMENT Forge environment — whimet4's `yanhui`, and any local
// `forge:tunnel` session — silently lost any backend route added after that
// project was last deployed. The attachment app-fallback surfaced it as
// "cannot parse body as JSON. Status: 405".
//
// Pointing dev at staging keeps the invariant above satisfiable: the whimet4
// workflow already sets BACKEND_API_BASE_URL=conf-stg-lite, so client and
// manifest now agree. The tradeoff is that dev traffic reads/writes the staging
// D1 + KV; that was already true of anything routed through the manifest remote.
const REMOTE_BASE_URL_MAP = {
  DEVELOPMENT_LITE: 'https://conf-stg-lite.zenuml.com',
  STAGING_LITE: 'https://conf-stg-lite.zenuml.com',
  PRODUCTION_LITE: 'https://conf-lite.zenuml.com',
  DEVELOPMENT_FULL: 'https://conf-stg-full.zenuml.com',
  STAGING_FULL: 'https://conf-stg-full.zenuml.com',
  PRODUCTION_FULL: 'https://conf-full.zenuml.com',
  DEVELOPMENT_ASYNCAPI: 'https://conf-stg-lite.zenuml.com',
  STAGING_ASYNCAPI: 'https://conf-stg-lite.zenuml.com',
  PRODUCTION_ASYNCAPI: 'https://zenapi.zenuml.com',
};

// Map the resolved product variant to its REMOTE_BASE_URL_MAP key suffix.
// asyncapi must NOT fall through to 'FULL' — its backend is the Lite project,
// not conf-*-full (see BACKEND_API_BASE_URL in the forge:*:asyncapi:* scripts).
type RemoteUrlVariant = 'ASYNCAPI' | 'LITE' | 'FULL';

function remoteUrlVariant(flags: {
  isAsyncApi?: boolean
  isLite?: boolean
  isDiagramly?: boolean
}): RemoteUrlVariant {
  if (flags.isAsyncApi) return 'ASYNCAPI';
  if (flags.isLite || flags.isDiagramly) return 'LITE';
  return 'FULL';
}

// Pure, exported for unit testing: resolve the backend origin for a given Forge
// environmentType ('DEVELOPMENT' | 'STAGING' | 'PRODUCTION') and product-variant
// flags. Returns undefined for an unknown environment key.
export function resolveZenumlRemoteBaseUrl(
  environmentType: string,
  flags: { isAsyncApi?: boolean; isLite?: boolean; isDiagramly?: boolean },
): string | undefined {
  const key = `${environmentType}_${remoteUrlVariant(flags)}` as keyof typeof REMOTE_BASE_URL_MAP;
  return REMOTE_BASE_URL_MAP[key];
}

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
  global.isAsyncApi = import.meta.env.PRODUCT_TYPE === 'asyncapi';
  global.zenumlRemoteBaseUrl = resolveZenumlRemoteBaseUrl('DEVELOPMENT', global);
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
    global.isAsyncApi = import.meta.env.PRODUCT_TYPE === 'asyncapi';
    global.zenumlRemoteBaseUrl = resolveZenumlRemoteBaseUrl(ctx.environmentType, global);
    // KEEP — a documented investigation technique (docs/superpowers/plans/
    // 2026-07-18-job-b-spike-findings.md) captures this exact console line via
    // Playwright's page.on('console') to read the real Forge `ap.context`.
    console.log('forgeGlobal - context', global.forgeContext);
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
    // Phase 0b: time the first, uncached context resolve (the Forge bridge
    // round-trip). renderPerf.time records once, so later cache hits — which
    // skip this branch entirely — never overwrite it.
    await renderPerf.time('context', () => getView());
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

// In-product navigation to a Confluence page, for surfaces that hold a
// spaceKey + pageId but no page context of their own (the homepage feed card).
// `router.navigate` keeps the user inside Confluence — `openUrl`/`router.open`
// would spawn a tab — and is the same call BylineDiagrams uses to reach a
// page's editor. Plain `<a href>` is not an option: links inside a Custom UI
// iframe are inert under the Forge sandbox.
export async function navigateToPage(spaceKey: string, pageId: string) {
  const path = `/wiki/spaces/${spaceKey}/pages/${pageId}`;
  if (global.isForge) {
    const { router } = await import("@forge/bridge");
    await router.navigate(path);
  } else {
    window.open(path, '_blank', 'noopener,noreferrer');
  }
}

// @ts-ignore
window.forgeGlobal = global;

export default global;
