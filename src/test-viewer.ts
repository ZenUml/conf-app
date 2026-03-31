/**
 * Local test entry point for the Viewer page.
 * Opens at http://localhost:8080/test-viewer.html?outputType=display
 *
 * Uses MockAp automatically (no Confluence connection needed).
 * MockAp returns a sample ZenUML sequence diagram from:
 *   src/model/Ap/MockedResponse/custom-content-by-id-v1-diagram-sequence.json
 */
import globals from '@/model/globals';
import './assets/tailwind.css'

async function main() {
  await globals.apWrapper.initializeContext();
  await globals.apWrapper.getMacroData();

  const [
    { default: defaultContentProvider },
    { mountRoot }
  ] = await Promise.all([
    import("@/model/ContentProvider/CompositeContentProvider"),
    import("@/mount-root")
  ]);

  const compositeContentProvider = defaultContentProvider(globals.apWrapper as any);
  const { doc } = await compositeContentProvider.load();

  const DiagramPortal = (await import("@/components/DiagramPortal.vue")).default;
  mountRoot(doc, DiagramPortal, { autoResize: false });
}

main().catch(e => console.error('test-viewer init error:', e));
