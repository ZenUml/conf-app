<template>
  <a class="discussion p-1 mx-1 flex justify-center items-center rounded bg-gray-100 hover:bg-gray-200 transition-colors" @click="openSurvey"
     href="#">
    <svg width="24" height="24" fill="none" viewBox="-4 -4 24 24" role="presentation" class="css-16aeq0e"><path fill="currentcolor" d="M4.25 13.25v-.75h-.2l-.172.099zm-3.5 2H0a.75.75 0 0 0 1.122.651zM2.625 2h10.75V.5H2.625zM14.5 3.125v8.25H16v-8.25zM13.375 12.5H4.25V14h9.125zm-9.497.099-3.5 2 .744 1.302 3.5-2zM1.5 15.25V3.125H0V15.25zM4 6.5h8V5H4zm0 3h5V8H4zm10.5 1.875c0 .621-.504 1.125-1.125 1.125V14A2.625 2.625 0 0 0 16 11.375zM13.375 2c.621 0 1.125.504 1.125 1.125H16A2.625 2.625 0 0 0 13.375.5zM2.625.5A2.625 2.625 0 0 0 0 3.125h1.5C1.5 2.504 2.004 2 2.625 2z"></path></svg>
    <span class="px-1 text-sm">Comment on Diagram</span>
  </a>
</template>

<script setup lang="ts">
import { trackEvent } from '@/utils/window'
import AP from "@/model/AP";

const openSurvey = (e: Event) => {
  e.preventDefault();
  trackEvent('feedback', 'click', 'survey');

  AP.dialog.create({
    key: 'zenuml-content-dashboard',
    chrome: true,
    width: "100%",
    height: "100%",
    customData: {type: 'survey'}
  }).on('close', () => {
    trackEvent('feedback', 'dialog_closed', 'survey');
  });
}
</script>
