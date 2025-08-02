const global = {
  isForge: false,
  forgeContext: undefined,
  view: undefined,
} as any;

export async function getView() {
  if(!global.view) {
    const { view } = await import("@forge/bridge");
    global.view = view;
    global.isForge = true;
  }
  return global.view;
}

export async function getContext() {
  if(!global.forgeContext) {
    global.forgeContext = await (await getView()).getContext();
    console.log('forgeGlobal - context', global.forgeContext);
  }
  return global.forgeContext;
}

export async function isEditorMode() {
  const context = await getContext();
  return context.extension.modal?.macroMode === 'editor' || context.extension?.macro?.isConfiguring;
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

// @ts-ignore
window.forgeGlobal = global;

export default global;