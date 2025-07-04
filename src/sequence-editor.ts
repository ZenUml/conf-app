import ApWrapper2 from "@/model/ApWrapper2";
import defaultContentProvider from "@/model/ContentProvider/CompositeContentProvider";
import globals from "@/model/globals";

import Workspace from './components/Workspace.vue'
import { mountRoot } from "@/mount-root";

import store from './model/store2'
import EventBus from './EventBus'
import AP from "@/model/AP";

import { saveToPlatform } from "@/model/ContentProvider/Persistence";
import './utils/IgnoreEsc.ts'

import './assets/tailwind.css'
import { DiagramType, NULL_DIAGRAM } from "@/model/Diagram/Diagram";
import Example from "@/utils/sequence/Example";
import { trackEvent } from "@/utils/window";
import MacroUtil from "@/model/MacroUtil";
import { view, requestConfluence, invoke } from "@forge/bridge";

// Track editor session start time
const editorStartTime = Date.now();

async function main() {
  console.log('sequence-editor - main');

  const context = await view.getContext();
  (globals.apWrapper as ApWrapper2).isForge = !!context;

  const { accountId, cloudId, moduleKey, extension: {config: {customContentId, updatedAt, uuid}, content: {id}} } = context;
  console.log('sequence-editor - context', context);

  const customContent2 = await globals.apWrapper.getCustomContentByIdV2(customContentId);
  console.log('Custom content2:', customContent2);

  await globals.apWrapper.initializeContext();
  let doc = customContent2?.value;
  console.log('loaded document', doc);

  if (doc === NULL_DIAGRAM) {
    console.log('document is null, loading example');
    doc = {
      diagramType: DiagramType.Sequence,
      code: Example.Sequence,
      mermaidCode: Example.Mermaid,
      isNew: true
    }
  }

  mountRoot(doc, Workspace, () => {
    // @ts-ignore
    if(AP?.sizeToParent) {
      AP.sizeToParent(true);
    }

    const resize = () => {
      const desiredHeight = document.body.scrollHeight;
      window.parent.postMessage({
        type: 'resize',
        height: desiredHeight
      }, '*');
      console.log('postMessage', desiredHeight);
    };

    setTimeout(resize, 1000);
    setTimeout(resize, 3000);
  });

  if (await MacroUtil.isCreateNew()) {
    trackEvent('', 'create_macro_begin', 'sequence');
  }
}

// We do not have to export main(), but otherwise IDE shows a warning
export default main();

EventBus.$on('save', async () => {
  const isNewSequence = !store.state.diagram.id && store.state.diagram.diagramType === "sequence"
  store.state.diagram.isNew = false;
  const id = await saveToPlatform(store.state.diagram);
  const preservedTheme = sessionStorage.getItem(`${location.hostname}-preserve-zenuml-conf-theme`);
  if (isNewSequence && preservedTheme) {
    sessionStorage.removeItem(`${location.hostname}-preserve-zenuml-conf-theme`);
    localStorage.setItem(`${location.hostname}-${id}-zenuml-conf-theme`, preservedTheme);
  }
  // Give some time for track event to be sent out. We are not using a more reliable way to track event because
  // we don't want to block dialog close for too long.
  setTimeout(() => {
    // @ts-ignore
    AP.dialog.close();
  }, 500);
});

EventBus.$on('exit', async (showWarning: boolean) => {
  console.log('exit', showWarning);
  
  // Track exit event with context
  const isNewSequence = !store.state.diagram.id && store.state.diagram.diagramType === "sequence";
  const elapsedTimeMs = Date.now() - editorStartTime;
  
  trackEvent('', 'create_macro_exit', 'sequence', {
    had_changes: showWarning,
    macro_stage: isNewSequence ? 'creation' : 'editing',
    elapsed_time_ms: elapsedTimeMs,
    code_length: store.state.diagram.code?.length || 0
  });
  
  if (showWarning) {
    AP.dialog.create({
      key: 'zenuml-close-without-saving-dialog',
      width: 500,
      height: 300,
      chrome: false,
    }).on('close', (data: any) => {
      // close the editor dialog if the user clicks on the discard button
      if (data.action === 'discard') {
        AP.dialog.close();
      }
    });
  } else {
    AP.dialog.close();
  }
});
