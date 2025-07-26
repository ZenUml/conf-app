import globals from "@/model/globals";
import { getView, getContext as initForgeContext, isInserting } from './model/globals/forgeGlobal';
import { saveToPlatform } from "@/model/ContentProvider/Persistence";
import { decompress } from "@/utils/compress";
import defaultContentProvider from "@/model/ContentProvider/CompositeContentProvider";
import ApWrapper2 from "@/model/ApWrapper2";
import MacroUtil from "@/model/MacroUtil";
import { trackEvent } from "@/utils/window";
import { mountRoot } from "@/mount-root";
import ForgeGraphEditor from "@/components/DrawIoExtension/ForgeGraphEditor.vue";
import { DiagramType, DataSource } from "@/model/Diagram/Diagram";
import store from "@/model/store2";

// Type declarations for global window properties
declare global {
  interface Window {
    diagram: any;
    graphXml?: string;
  }
}

const EMPTY_GRAPH = `<mxfile>
  <diagram name="Page-1">
    <mxGraphModel dx="1434" dy="540" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="827" pageHeight="1169" math="0" shadow="0">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;

async function saveGraphAndExit(graphXml: string) {
  const diagram = {
    ...window.diagram,
    graphXml,
    diagramType: DiagramType.Graph,
    source: DataSource.CustomContent
  };
  
  const id = await saveToPlatform(diagram);
  
  setTimeout(async () => {
    if(await isInserting()) {
      await (await getView()).submit({config: {customContentId: id, updatedAt: new Date().toISOString()}});
    } else {
      await (await getView()).close();
    }
  }, 500);
}

async function exit() {
  const codeChanged = window.diagram?.graphXml !== window.graphXml;
  if (codeChanged) {
    alert('Changes detected. Close without saving?');
  } else {
    await (await getView()).close();
  }
}

async function initializeMacro() {
  const context = await initForgeContext();

  let doc;
  const customContentId = context.extension?.config?.customContentId;
  if(!customContentId) {
    doc = {
      diagramType: DiagramType.Graph,
      graphXml: EMPTY_GRAPH,
      isNew: true
    }
  } else {
    const customContent = await globals.apWrapper.getCustomContentByIdV2(customContentId);
    console.log('loadDiagram - customContent', customContent);
    doc = customContent?.value;
  }

  store.state.diagram = doc || {};
  window.diagram = doc || {};
  console.log('loadDiagram - window.diagram', window.diagram);

  let graphXml = doc?.graphXml;
  if (doc?.compressed) {
    trackEvent("compressed_field_editor", "load", "warning");
    if (!graphXml?.startsWith("<mxGraphModel")) {
      graphXml = decompress(doc.graphXml);
      trackEvent("compressed_content_editor", "load", "warning");
    }
  }

  if (graphXml) {
    // @ts-ignore
    window.graphXml = graphXml;
  }

  mountRoot(doc, ForgeGraphEditor, {
    graphXml,
    saveGraphAndExit,
    doc
  });

  if (await MacroUtil.isCreateNew()) {
    trackEvent("", "create_macro_begin", "graph");
  }
}

export default initializeMacro(); 