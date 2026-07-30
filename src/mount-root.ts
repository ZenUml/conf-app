import { createApp, type Component } from "vue";
import type { Diagram } from "@/model/Diagram/Diagram";
import store from "@/model/store2";
import {
  viewerRenderReporterKey,
  type ViewerRenderReporter,
} from '@/utils/viewerRenderReporter';

let currentApp: any = null; // Keep track of mounted app

export interface MountRootOptions {
  viewerRenderReporter?: ViewerRenderReporter;
}

export function mountRoot(
  doc: Diagram,
  component: Component,
  props: Record<string, any> = {},
  options: MountRootOptions = {},
) {
  console.debug('Mounting root', doc);
  store.state.diagram = doc;
  // A fresh mount starts before the real doc is loaded; publishLoadedDiagram
  // flips this true once loadDiagram() resolves. See ExtendedStore state.
  store.state.diagramLoadComplete = false;

  const appElement = document.getElementById('app');
  if (appElement) {
    // Unmount existing app if it exists
    if (currentApp) {
      currentApp.unmount();
      console.debug('Unmounted existing app');
    }

    // Create and mount new app
    const app = createApp(component, props);
    if (options.viewerRenderReporter) {
      app.provide(viewerRenderReporterKey, options.viewerRenderReporter);
    }
    app.use(store).mount('#app');
    currentApp = app;
  }
}
