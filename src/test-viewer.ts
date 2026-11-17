/**
 * Local test entry point for the Viewer page.
 * Start with `pnpm start:local`, then append
 * `/test-viewer.html?outputType=display` to the URL from `pnpm dev:url`.
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
    { NULL_DIAGRAM },
    { mountRoot }
  ] = await Promise.all([
    import("@/model/Diagram/Diagram"),
    import("@/mount-root")
  ]);

  const id = (await globals.apWrapper.getMacroData())?.customContentId;
  const doc = id
    ? ((await globals.apWrapper.getCustomContentForCurrentPage(id)) as any)?.value
    : NULL_DIAGRAM;

  const DiagramPortal = (await import("@/components/DiagramPortal.vue")).default;
  mountRoot(doc, DiagramPortal, { autoResize: false });
}

main().catch(e => console.error('test-viewer init error:', e));
