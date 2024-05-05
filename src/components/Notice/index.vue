<template>
  <div v-show="showNotice">
    <div class="bg-orange-50 border-t-4 border-orange-500 rounded-b text-orange-700 px-4 py-3 shadow-md" role="alert">
      <div class="flex">
        <div class="py-1">
          <svg class="fill-current h-6 w-6 text-orange-500 mr-4" viewBox="0 0 24 24" role="presentation"><path d="M13.31 5.343l7.359 13.17A1 1 0 0119.796 20H4.204a1 1 0 01-.873-1.488l7.36-13.169a1.5 1.5 0 012.618 0zM12 8.5a1.091 1.091 0 00-1.081 1.239l.513 3.766a.573.573 0 001.136 0l.513-3.766A1.091 1.091 0 0012 8.5zm0 8.63a1.125 1.125 0 100-2.25 1.125 1.125 0 000 2.25z" fill="currentColor" fill-rule="evenodd"></path></svg>
        </div>
        <div>
          <p class="font-bold">Notice: We’re soon introducing a limit on the number of macros clients on the free tier can create and modify.</p>
          <p class="">
            Your organization has already created over 1,000 macros!
            <a class="font-medium text-blue-600 dark:text-blue-500 hover:underline" href="https://zenuml.com/upgrade/" target="_blank">Upgrade for unlimited creation and modification</a>, or
            <a class="font-medium text-blue-600 dark:text-blue-500 hover:underline" href="https://zenuml.com/docs/about/contact-us#contact-us" target="_blank">contact us for support</a>.
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {onMounted, ref} from 'vue';
import getFeatureFlagsForCurrentDomain from "@/apis/featureFlags";
import {trackEvent} from "@/utils/window";
import globals from "@/model/globals";

const showNotice = ref(false);
onMounted(async() => {
  const isLite = globals.apWrapper.isLite();
  const macroData = await globals.apWrapper.getMacroData();
  if (!isLite) {
    trackEvent(macroData?.uuid, 'skip', 'upgrade-notice')
    return;
  }

  trackEvent(macroData?.uuid, 'get-feature-flags', 'upgrade-notice')
  const customerSuccessService = await getFeatureFlagsForCurrentDomain(['CUSTOMER_SUCCESS_SERVICE']);
  // @ts-ignore
  if (!customerSuccessService.CUSTOMER_SUCCESS_SERVICE) {
    trackEvent(macroData?.uuid, 'hold', 'upgrade-notice')
  } else {
    trackEvent(macroData?.uuid, 'show-notice', 'upgrade-notice')
    showNotice.value = true;
  }
});

</script>
