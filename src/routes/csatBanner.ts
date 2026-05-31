import { createApp } from 'vue';
import globals from '@/model/globals';
import CsatBanner from '@/components/CSAT/CsatBanner.vue';

export async function handleCsatBannerRoute() {
  const container = document.getElementById('app');
  if (!container) {
    console.error('[csat-banner] #app container not found');
    return;
  }
  await globals.apWrapper.initializeContext();
  createApp(CsatBanner).mount(container);
}
