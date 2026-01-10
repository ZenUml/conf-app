const global = {
  isForge: false,
  forgeContext: undefined,
  view: undefined,
  zenumlRemoteBaseUrl: undefined,
  isLite: undefined,
} as any;

const REMOTE_BASE_URL_MAP = {
  DEVELOPMENT_LITE: 'https://confluence-plugin.pages.dev',
  STAGING_LITE: 'https://conf-stg-lite.zenuml.com',
  PRODUCTION_LITE: 'https://conf-lite.zenuml.com',
  DEVELOPMENT_FULL: 'https://confluence-plugin.pages.dev',
  STAGING_FULL: 'https://conf-stg-full.zenuml.com',
  PRODUCTION_FULL: 'https://conf-full.zenuml.com',
};

export async function getView() {
  if(!global.view) {
    const { view } = await import("@forge/bridge");
    global.view = view;
    global.isForge = true;
    global.forgeContext = await view.getContext();

    global.isLite = global.forgeContext.moduleKey.endsWith("-lite");
    global.zenumlRemoteBaseUrl = REMOTE_BASE_URL_MAP[`${global.forgeContext.environmentType}_${global.isLite ? 'LITE' : 'FULL'}`];

    console.log('forgeGlobal - context', global.forgeContext);
    console.debug('forgeGlobal - zenumlRemoteBaseUrl', global.zenumlRemoteBaseUrl);
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

export async function openModal(options: any) {
  const { Modal } = await import("@forge/bridge");
  const modal = new Modal(options);
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
  const { router } = await import("@forge/bridge");
  router.open(url);
}

// @ts-ignore
window.forgeGlobal = global;

export default global;