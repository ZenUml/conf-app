import { createApp, Component } from "vue";
import {Diagram} from "@/model/Diagram/Diagram";
import store from "@/model/store2";

let currentApp: any = null; // Keep track of mounted app

export function mountRoot(doc: Diagram, component: Component, props: Record<string, any> = {}) {
  console.debug('Mounting root', doc);
  // extract title from diagram code
  if (!doc.title && doc.diagramType === 'sequence') {
    const firstLine = doc.code?.split('\n')[0];
    if (firstLine?.trimStart().startsWith('title ')) {
      doc.title = firstLine.trimStart().substring(6).trim();
    }
  }
  store.state.diagram = doc;

  const appElement = document.getElementById('app');
  if (appElement) {
    // Unmount existing app if it exists
    if (currentApp) {
      currentApp.unmount();
      console.debug('Unmounted existing app');
    }

    // Create and mount new app
    const app = createApp(component, props);
    app.use(store).mount('#app');
    currentApp = app;
  }
}
