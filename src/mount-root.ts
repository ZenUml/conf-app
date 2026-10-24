import { createApp, Component } from "vue";
import {Diagram, DiagramType} from "@/model/Diagram/Diagram";
import store from "@/model/store2";

let currentApp: any = null; // Keep track of mounted app

export function mountRoot(doc: Diagram, component: Component, props: Record<string, any> = {}) {
  store.state.diagram = doc;
  store.state.diagramAttribution = null;
  // A fresh mount starts before the real doc is loaded; publishLoadedDiagram
  // flips this true once loadDiagram() resolves. See ExtendedStore state.
  store.state.diagramLoadComplete = false;

  const appElement = document.getElementById('app');
  if (appElement) {
    // Unmount existing app if it exists
    if (currentApp) {
      currentApp.unmount();
    }

    // Create and mount new app
    const app = createApp(component, props);
    app.use(store).mount('#app');
    currentApp = app;
  }
}
