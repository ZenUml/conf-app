import { createApp } from 'vue';
import globals from '@/model/globals';
import PaywallWarningBanner from '@/components/UpgradePrompt/PaywallWarningBanner.vue';

export async function handlePaywallBannerRoute() {
  const container = document.getElementById('app');
  if (!container) {
    console.error('[paywall-banner] #app container not found');
    return;
  }
  await globals.apWrapper.initializeContext();
  createApp(PaywallWarningBanner).mount(container);
}
