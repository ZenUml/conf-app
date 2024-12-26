import { createApp } from 'vue'
import DashboardDocumentList from './components/DocumentList/DashboardDocumentList.vue'

import EventBus from './EventBus'
import AP from "@/model/AP";
import './assets/tailwind.css'
import './utils/IgnoreEsc.ts'
import ApWrapper2 from "@/model/ApWrapper2";
import uuidv4 from "@/utils/uuid";
import {trackEvent} from '@/utils/window';
import globals from '@/model/globals';

const apWrapper = new ApWrapper2(AP);

if(document.getElementById('app')) {
  (async () => {
    await globals.apWrapper.initializeContext();
    trackEvent('', 'load_dashboard', 'pageview');

    // Check if we should show survey
    const customData = await globals.apWrapper.getDialogCustomData();
    console.log('customData', customData);
    if (customData?.type === 'survey') {
      // Create survey container
      const surveyContainer = document.createElement('div');
      surveyContainer.innerHTML = `
        <div
          data-heyform-id="EOwPINVG"
          data-heyform-type="standard"
          data-heyform-custom-url="https://hey2.diagramly.ai/form/"
          data-heyform-width-type="%"
          data-heyform-width="100"
          data-heyform-height-type="px"
          data-heyform-height="500"
          data-heyform-auto-resize-height="true"
        ></div>
      `;
      document.body.appendChild(surveyContainer);

      // Load HeyForm script
      const script = document.createElement('script');
      script.src = 'https://www.unpkg.com/@heyform-inc/embed@latest/dist/index.umd.js';
      document.body.appendChild(script);

      trackEvent('survey', 'embedded', 'dashboard');
    } else {
      // Mount DashboardDocumentList for non-survey cases
      const app = createApp(DashboardDocumentList);
      app.mount('#app');
    }
  })();
}

EventBus.$on('save', async () => {
  const macroData = await apWrapper.getMacroData();
  const uuid = macroData?.uuid || uuidv4();
  // @ts-ignore
  const params = { uuid, customContentId: window.picked.id, updatedAt: new Date() };
  apWrapper.saveMacro(params, '');

  if(!macroData?.uuid) {
    trackEvent(uuid, 'create_macro_end', 'embed');
  }

  // @ts-ignore
  AP.dialog.close();
});

EventBus.$on('exit', async () => {
  AP.dialog.close();
});
