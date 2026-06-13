import MockAp from '@/model/MockAp';
import forgeGlobal from '@/model/globals/forgeGlobal';
import { getPresetById, type SandboxPreset } from '@/sandbox/presets';

const DEVELOPMENT_REMOTE_BASE_URL = 'https://confluence-plugin.pages.dev';
const mockAp = new MockAp();
const PAYWALL_MOCKS: Record<string, string> = {
  mockMacroCount: '105',
  mockCSSEnabled: 'true',
  mockSpacePaid: 'false',
  mockSpaceKey: 'SD',
  mockClientDomain: 'lite-stg',
};
const SANDBOX_CONTINUE_ATTEMPTS_KEY =
  'paywallContinueAttempts:lite-stg:SD:forge-sandbox-user';

interface BridgeFetchPayload {
  restPath?: string;
  fetchRequestInit?: {
    body?: string;
    method?: string;
  };
}

interface BridgeInvokePayload {
  invokeType?: string;
}

function requestWithMockAp(payload: BridgeFetchPayload): Promise<any> {
  const url = (payload.restPath || '').replace(/^\/wiki/, '');
  const body = payload.fetchRequestInit?.body;
  return mockAp.request({
    url,
    type: payload.fetchRequestInit?.method || 'GET',
    body,
    data: body,
    contentType: 'application/json',
  });
}

async function createFetchResponse(payload: BridgeFetchPayload): Promise<Record<string, unknown>> {
  const response = await requestWithMockAp(payload);
  return {
    body: response?.body || '{}',
    headers: { 'content-type': 'application/json' },
    statusText: response?.xhr?.statusText || 'OK',
    status: response?.xhr?.status || 200,
    isAttachment: false,
  };
}

function createViewStub() {
  return {
    submit: async (options: any) => {
      console.log('[sandbox] view.submit() - no-op', options);
    },
    close: async () => {
      console.log('[sandbox] view.close() - reloading page');
      window.location.reload();
    },
  };
}

function configurePaywallMocks(enabled: boolean): void {
  try {
    for (const [key, value] of Object.entries(PAYWALL_MOCKS)) {
      if (enabled) {
        localStorage.setItem(key, value);
      } else {
        localStorage.removeItem(key);
      }
    }

    if (!enabled) {
      localStorage.removeItem(SANDBOX_CONTINUE_ATTEMPTS_KEY);
    }
  } catch {
    // Local storage is optional in restrictive browser contexts.
  }
}

function getPreset(params: URLSearchParams): SandboxPreset {
  const presetId = params.get('sandbox') || 'seq-edit';
  const preset = getPresetById(presetId);
  if (!preset) {
    throw new Error(`Unknown sandbox preset "${presetId}"`);
  }
  return preset;
}

function createContext(params: URLSearchParams, preset: SandboxPreset): any {
  const isEditor = preset.macroMode === 'editor';
  const pageId = params.get('pageId') || 'local-dev-page';
  const spaceKey = params.get('spaceKey') || 'SD';
  const uuid = params.get('uuid') || 'local-dev-uuid';
  const siteUrl = params.get('siteUrl') || 'https://example.atlassian.net';

  return {
    extension: {
      type: 'standalone',
      content: { id: pageId, type: 'page' },
      config: { uuid, customContentId: preset.customContentId },
      space: { key: spaceKey },
      location: `${siteUrl}/wiki/spaces/${spaceKey}/pages/${pageId}`,
      modal: isEditor ? { macroMode: preset.macroMode, diagramType: preset.diagramType } : undefined,
      macro: { isConfiguring: isEditor, isInserting: false },
    },
    moduleKey: preset.moduleKey,
    environmentType: 'DEVELOPMENT',
    siteUrl,
    accountId: 'forge-sandbox-user',
    localId: undefined,
    license: undefined,
  };
}

function createRemoteInvokeResponse(): Record<string, unknown> {
  return {
    success: true,
    payload: {
      status: 200,
      body: {},
      headers: { 'content-type': 'application/json' },
    },
  };
}

export async function callSandboxBridge(method: string, payload: unknown): Promise<unknown> {
  switch (method) {
    case 'getContext':
      return forgeGlobal.forgeContext;
    case 'fetchProduct':
      return createFetchResponse(payload as BridgeFetchPayload);
    case 'fetchRemote':
      return createFetchResponse({});
    case 'invoke':
      return (payload as BridgeInvokePayload)?.invokeType
        ? createRemoteInvokeResponse()
        : {};
    case 'onClose':
    case 'submit':
    case 'close':
    case 'openModal':
    case 'navigate':
    case 'reload':
    case 'refresh':
    case 'emitReadyEvent':
    case 'enableTheming':
    case 'changeWindowTitle':
      return true;
    case 'getUrl':
      return window.location.href;
    default:
      throw new Error(`Unsupported sandbox Forge bridge method "${method}"`);
  }
}

function installBridgeShim(): void {
  (globalThis as any).__bridge = {
    callBridge: async (method: string, payload: unknown) => {
      console.debug(`[sandbox] Forge bridge shim: ${method}`, payload);
      return callSandboxBridge(method, payload);
    },
  };
}

export function installSandboxRuntime(): SandboxPreset {
  const params = new URLSearchParams(window.location.search);
  const preset = getPreset(params);
  configurePaywallMocks(preset.paywall === true);

  installBridgeShim();
  forgeGlobal.isForge = false;
  forgeGlobal.view = createViewStub();
  forgeGlobal.forgeContext = createContext(params, preset);
  forgeGlobal.isDiagramly = import.meta.env.PRODUCT_TYPE === 'diagramly';
  forgeGlobal.isLite = import.meta.env.PRODUCT_TYPE === 'lite';
  forgeGlobal.zenumlRemoteBaseUrl = DEVELOPMENT_REMOTE_BASE_URL;

  console.log('[sandbox] Installed Forge runtime', {
    preset: preset.id,
    context: forgeGlobal.forgeContext,
  });
  return preset;
}
