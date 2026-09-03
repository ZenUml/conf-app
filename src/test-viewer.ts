/**
 * Local test entry point for the Viewer page.
 * Opens at http://localhost:8080/test-viewer.html?outputType=display
 *
 * Uses MockAp automatically (no Confluence connection needed).
 * MockAp returns a sample ZenUML sequence diagram from:
 *   src/model/Ap/MockedResponse/custom-content-by-id-v1-diagram-sequence.json
 */
import globals from '@/model/globals';
import { getContext } from '@/model/globals/forgeGlobal';
import './assets/tailwind.css'

async function main() {
  // Local dev has no real Forge bridge. The real entry point (forgeIndex.ts's
  // initializeCriticalPath) awaits this as its very first step so
  // forgeGlobal.forgeContext is populated before anything reads it — this
  // harness skipped that, leaving forgeContext undefined and every content
  // lookup below resolving to nothing (see test-viewer.html's ?sandbox=
  // default + src/sandbox/presets.ts for the standalone context it provides).
  await getContext();
  await globals.apWrapper.initializeContext();
  await globals.apWrapper.getMacroData();

  const [
    { MacroIdProvider },
    { CustomContentStorageProvider },
    { NULL_DIAGRAM },
    { mountRoot }
  ] = await Promise.all([
    import("@/model/ContentProvider/MacroIdProvider"),
    import("@/model/ContentProvider/CustomContentStorageProvider"),
    import("@/model/Diagram/Diagram"),
    import("@/mount-root")
  ]);

  const id = await new MacroIdProvider(globals.apWrapper as any).getId();
  const doc = id
    ? await new CustomContentStorageProvider(globals.apWrapper as any).getDiagram(id)
    : NULL_DIAGRAM;

  const DiagramPortal = (await import("@/components/DiagramPortal.vue")).default;
  mountRoot(doc, DiagramPortal, { autoResize: false });
}

main().catch(e => console.error('test-viewer init error:', e));
