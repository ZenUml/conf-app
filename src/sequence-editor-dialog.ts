import ApWrapper2 from "@/model/ApWrapper2";
import defaultContentProvider from "@/model/ContentProvider/CompositeContentProvider";
import globals from "@/model/globals";

import Workspace from './components/Workspace.vue'
import { mountRoot } from "@/mount-root";

import store from './model/store2'
import EventBus from './EventBus'
import AP from "@/model/AP";
import './utils/IgnoreEsc.ts'

import './assets/tailwind.css'
import { saveToPlatform } from "@/model/ContentProvider/Persistence";

async function main() {
  await globals.apWrapper.initializeContext();
  const compositeContentProvider = defaultContentProvider(globals.apWrapper as ApWrapper2);
  let { doc } = await compositeContentProvider.load();
  mountRoot(doc, Workspace);
}

// We do not have to export main(), but otherwise IDE shows a warning
export default main();

EventBus.$on('save', async () => {
  const isNewSequence = !store.state.diagram.id && store.state.diagram.diagramType === "sequence"
  const id = await saveToPlatform(store.state.diagram);
  const preservedTheme = sessionStorage.getItem(`${location.hostname}-preserve-zenuml-conf-theme`);
  if (isNewSequence && preservedTheme) {
    sessionStorage.removeItem(`${location.hostname}-preserve-zenuml-conf-theme`);
    localStorage.setItem(`${location.hostname}-${id}-zenuml-conf-theme`, preservedTheme);
  }
  // Set flag for new diagram saved
  localStorage.setItem('zenuml-show-survey', 'true');
  // Give some time for track event to be sent out. We are not using a more reliable way to track event because
  // we don't want to block dialog close for too long.
  setTimeout(() => {
    // @ts-ignore
    AP.dialog.close();
  }, 500);
});

EventBus.$on('exit', async (showWarning: boolean) => {
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
