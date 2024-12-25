import ApWrapper2 from "@/model/ApWrapper2";
import defaultContentProvider from "@/model/ContentProvider/CompositeContentProvider";
import globals from '@/model/globals';

import DiagramPortal from "@/components/DiagramPortal.vue";
import {mountRoot} from "@/mount-root";

import AP from "@/model/AP";
import EventBus from './EventBus'
import {trackEvent} from "@/utils/window";
import createAttachmentIfContentChanged from "@/model/Attachment";
import {Diagram, DiagramType} from "@/model/Diagram/Diagram";

import './assets/tailwind.css'
import { saveToPlatform } from "./model/ContentProvider/Persistence";
import macroMetrics from "@/services/MacroMetrics";

async function main() {
  await globals.apWrapper.initializeContext();
  const macroData = await globals.apWrapper.getMacroData();
  trackEvent(macroData?.uuid, 'view_macro', 'sequence');

  const compositeContentProvider = defaultContentProvider(globals.apWrapper as ApWrapper2);
  let {doc} = await compositeContentProvider.load();
  mountRoot(doc, DiagramPortal);

  await macroMetrics.reportMacroMetrics();
}

export default main()

EventBus.$on('diagramLoaded', () => {
  console.debug('Resize macro');
  // @ts-ignore
  setTimeout(window.AP?.resize, 1500)
});

async function createAttachment(code: string, diagramType: DiagramType) {
  try {
    if (globals.apWrapper.isDisplayMode() && await globals.apWrapper.canUserEdit()) {
      await createAttachmentIfContentChanged(code);
    } else {
      console.debug("Attachment will no be created as it's not in view mode or the user is unauthorized to edit.");
    }
  } catch (e) {
    // Do not re-throw the error
    console.error("Error when creating attachment", e);
    trackEvent(JSON.stringify(e), 'create_attachment' + diagramType, 'error');
  }
}

EventBus.$on('diagramLoaded', async (code: string, diagramType: DiagramType) => {
  setTimeout(async () => {
    await createAttachment(code, diagramType);

    // Check if we should show the survey
    const surveyTargetId = localStorage.getItem('zenuml-show-survey');
    const hasTakenSurvey = localStorage.getItem('zenuml-page-to-diagram-survey-taken') === 'true';
    const macroData = await globals.apWrapper.getMacroData();

    if (surveyTargetId && surveyTargetId === macroData?.customContentId && !hasTakenSurvey && diagramType === DiagramType.Sequence) {
      setTimeout(() => {
        // Track survey shown
        trackEvent(macroData.customContentId, 'survey_shown', 'sequence');

        AP.dialog.create({
          key: 'zenuml-page-to-diagram-survey',
          chrome: true,
          width: '100%',
          height: '100%'
        }).on('close', (data: any) => {
          // Mark survey as taken and clear the show flag
          localStorage.setItem('zenuml-page-to-diagram-survey-taken', 'true');
          localStorage.removeItem('zenuml-show-survey');

          // Track survey completion or closure
          trackEvent(macroData.customContentId, 'survey_closed', 'sequence', data);
        });
      }, 2000); // Show survey after diagram is fully loaded and visible
    }
  }, 1500);
});

EventBus.$on('edit', () => {
  AP.dialog.create({
    key: 'zenuml-content-sequence-editor-dialog',
      chrome: false,
      width: "100%",
      height: "100%",
  }).on('close', async () => {
    location.reload();
  });
});

EventBus.$on('fullscreen', () => {
  AP.dialog.create({
    key: 'zenuml-content-sequence-viewer-dialog',
    chrome: true,
    width: "100%",
    height: "100%",
  }).on('close', async () => {
    location.reload();
  });
});

EventBus.$on('updateContent', async (diagram: Diagram) => {
  if (await globals.apWrapper.canUserEdit()) {
    saveToPlatform(diagram)
  } else {
    AP.messages.info('Your changes cannot be persistent as you are not authorized to edit.');
  }
});
