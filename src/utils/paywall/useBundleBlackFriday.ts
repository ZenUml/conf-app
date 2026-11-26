import { onMounted, onUnmounted, ref } from 'vue';
import { BLACK_FRIDAY_END, BLACK_FRIDAY_START, BLACK_FRIDAY_STRIPE_CODE, blackFridayActive } from './bundleBlackFriday';

export function useBundleBlackFriday() {
  const storybookPreview = import.meta.env.VITE_APP_VERSION === 'storybook'
    && import.meta.env.VITE_PREVIEW_BUNDLE_BLACK_FRIDAY === 'true';
  const enabled = import.meta.env.PRODUCT_TYPE === 'lite' && Boolean(BLACK_FRIDAY_STRIPE_CODE);
  const active = ref(storybookPreview || (enabled && blackFridayActive(Date.now())));
  let timer: ReturnType<typeof setTimeout> | undefined;

  function refresh() {
    const now = Date.now();
    active.value = blackFridayActive(now);
    const nextChange = now < BLACK_FRIDAY_START ? BLACK_FRIDAY_START : BLACK_FRIDAY_END;
    if (now < nextChange) timer = setTimeout(refresh, Math.min(nextChange - now, 2_147_483_647));
  }

  onMounted(() => {
    if (enabled && !storybookPreview) refresh();
  });
  onUnmounted(() => clearTimeout(timer));
  return active;
}
