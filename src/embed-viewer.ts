import {trackEvent} from "@/utils/window";
import AP from "@/model/AP";
import defaultContentProvider from "@/model/ContentProvider/CompositeContentProvider";
import ApWrapper2 from "@/model/ApWrapper2";
import globals from '@/model/globals';
import { getViewerUrl } from "@/model/Diagram/DiagramTypeConfig";

function loadViewer(url: string) {
  const e = document.createElement('meta');
  e.setAttribute('http-equiv', 'refresh');
  e.setAttribute('content', `0;URL='${url}'`);
  const h = document.getElementsByTagName('head')[0];
  h && h.appendChild(e);
}

async function initializeMacro() {
  try {
    await globals.apWrapper.initializeContext();
    trackEvent('', 'view_macro', 'embed');

    const contentProvider = defaultContentProvider(new ApWrapper2(AP));
    const { doc } = await contentProvider.load()
    const { diagramType } = doc;

    if(diagramType) {
      const url = `${getViewerUrl(diagramType)}${window.location.search}`;
      loadViewer(url);
    }
  } catch (e) {
    console.error('Error on initializing macro:', e);
    trackEvent(JSON.stringify(e), 'load_macro', 'error');
  }
}

initializeMacro();