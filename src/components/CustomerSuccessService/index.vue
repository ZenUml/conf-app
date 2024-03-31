<template>
  <transition name="fade">
    <div
        v-if="open"
        class="fixed h-fit top-1 right-1 drop-shadow-[0_20px_26px_rgba(176,176,176,0.35)]"
    >
      <div class="max-w-sm p-6 bg-white border border-gray-200 rounded-lg shadow dark:bg-gray-800 dark:border-gray-700">
        <a href="#">
          <h5 class="mb-2 text-2xl font-bold tracking-tight text-gray-900 dark:text-white">Dear User,</h5>
        </a>
        <p class="mb-3 font-normal text-gray-700 dark:text-gray-400">
          As one of the most frequent customers using ZenUML🌟, we want to offer you <strong>180 days</strong> of FREE, Top-Prioritized customer success services!✅
        </p>
        <p class="mb-3 font-normal text-gray-700 dark:text-gray-400">
          Click the BUTTON below ⬇️ to schedule a meeting with our Customer Success Manager!
        </p>
        <a href="/typeform-link" target="_blank"
           class="text-white justify-center flex items-center bg-blue-700 hover:bg-blue-800 w-full focus:ring-4 focus:ring-blue-300 font-medium rounded-lg text-sm px-5 py-2.5 mb-2 dark:bg-blue-600 dark:hover:bg-blue-700 focus:outline-none dark:focus:ring-blue-800">
          <svg class="w-3.5 h-3.5 me-2.5" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 20 20">
            <path d="M18 2h-2V1a1 1 0 0 0-2 0v1h-3V1a1 1 0 0 0-2 0v1H6V1a1 1 0 0 0-2 0v1H2a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2ZM2 18V7h6.7l.4-.409A4.309 4.309 0 0 1 15.753 7H18v11H2Z"/>
            <path d="M8.139 10.411 5.289 13.3A1 1 0 0 0 5 14v2a1 1 0 0 0 1 1h2a1 1 0 0 0 .7-.288l2.886-2.851-3.447-3.45ZM14 8a2.463 2.463 0 0 0-3.484 0l-.971.983 3.468 3.468.987-.971A2.463 2.463 0 0 0 14 8Z"/>
          </svg>
          Claim this Offer
        </a>
        <button class="text-gray-800 justify-center flex items-center bg-green-200 hover:bg-green-300 w-full font-medium rounded-lg text-sm px-5 py-2.5 mb-2">
          <svg fill="#000000" class="w-3.5 h-3.5 me-2.5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 235.319 235.319" xmlns:xlink="http://www.w3.org/1999/xlink" enable-background="new 0 0 235.319 235.319">
            <g>
              <path d="m201.094,29.997c2.649-0.623 4.623-2.996 4.623-5.835v-18.162c0-3.313-2.687-6-6-6h-164.114c-3.313,0-6,2.687-6,6v18.163c0,2.839 1.974,5.212 4.623,5.835 1.812,32.314 18.594,61.928 45.682,80.076l11.324,7.586-11.324,7.586c-27.089,18.147-43.871,47.762-45.682,80.076-2.649,0.623-4.623,2.996-4.623,5.835v18.163c0,3.313 2.687,6 6,6h164.114c3.313,0 6-2.687 6-6v-18.163c0-2.839-1.974-5.212-4.623-5.835-1.812-32.314-18.594-61.928-45.683-80.076l-11.324-7.586 11.324-7.586c27.089-18.148 43.871-47.763 45.683-80.077zm-159.491-17.997h152.114v6.163h-152.114v-6.163zm152.114,211.319h-152.114v-6.163h152.114v6.163zm-63.749-110.644c-1.663,1.114-2.661,2.983-2.661,4.985s0.998,3.871 2.661,4.985l18.765,12.571c23.71,15.883 38.49,41.705 40.333,69.941h-142.812c1.843-28.235 16.623-54.057 40.333-69.941l18.765-12.571c1.663-1.114 2.661-2.983 2.661-4.985s-0.998-3.871-2.661-4.985l-18.765-12.571c-23.71-15.884-38.49-41.706-40.333-69.941h142.812c-1.843,28.236-16.623,54.057-40.333,69.941l-18.765,12.571z"/>
              <path d="m133.307,82.66h-31.295c-2.487,0-4.717,1.535-5.605,3.858-0.888,2.324-0.25,4.955 1.604,6.613l15.647,14c1.139,1.019 2.57,1.528 4,1.528s2.862-0.509 4-1.528l15.647-14c1.854-1.659 2.492-4.29 1.604-6.613-0.885-2.323-3.115-3.858-5.602-3.858z"/>
              <path d="m117.414,140.581l-15.218,9.775c-13.306,8.914-21.292,23.876-21.292,39.892h76.511c0-16.016-7.986-30.978-21.292-39.892l-15.218-9.775c-1.074-0.644-2.416-0.644-3.491,0z"/>
            </g>
          </svg>
          Ask Me Tomorrow(4)
        </button>
      </div>
      <div v-if="!hasFeedback">
        <p></p>
      </div>
      <div>
        <transition name="fade-no-transform">
          <div
              class="bg-inherit rounded-lg flex flex-col py-[18px] -mx-[10px]"
              v-if="hasFeedback && customerSuccessServiceVal"
          >
            <div class="flex gap-2">
              <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
                <rect width="36" height="36" rx="18" fill="#1BA97F"/>
                <path d="M12.7119 18L16.4619 21.75L23.9619 14.25" stroke="white" stroke-width="1.125"
                      stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              <span class="text-center text-4xl font-bold">Thank You</span>
            </div>
            <p class="mt-4">Your review was successfully submitted.</p>
            <div class="flex justify-end mt-8">
              <button class="h-[52px] px-8 py-3 bg-[#282828] rounded-[6px] text-white" @click="handleCloseClick">Close
              </button>
            </div>
          </div>
        </transition>
      </div>
    </div>
  </transition>
</template>

<script setup lang="ts">
import {onMounted, onUnmounted, ref} from "vue";
import useCustomerSuccessServiceState from "@/hooks/useCustomerSuccessServiceState";
import {trackEvent} from "@/utils/window";

const score = ['\u{1F620}', '\u{1F612}', '\u{1F610}', '\u{1F60A}', '\u{1F60D}'];
const hasFeedback = ref(false);
const open = ref(false);
const customerSuccessServiceVal = ref<null | number>(null);

const {checkStateOfCustomerSuccessService, updateStateOfCustomerSuccessService} = useCustomerSuccessServiceState();

let timer: number;

onMounted(async () => {
  // const isPopped = await checkStateOfCustomerSuccessService();
  // if (!isPopped) {
    timer = setTimeout(() => {
      open.value = true;
    }, 1000 * 3)
  // }
});

onUnmounted(() => {
  clearTimeout(timer)
});

const handleSkipClick = () => {
  hasFeedback.value = true;
}

const handlePopTooFrequentlyClick = () => {
  trackEvent("customer_success_service", "customer_success_service_too_frequent", "operation");
  open.value = false;
  hasFeedback.value = false;
  updateStateOfCustomerSuccessService();
}

const handleTellUsMoreClick = () => {
  trackEvent("customer_success_service", "customer_success_service_tell_us_more", "operation");
  hasFeedback.value = true;
}

const handleCloseClick = () => {
  trackEvent("customer_success_service", "click", "operation", {
    customer_success_service_value: customerSuccessServiceVal.value,
  });

  setTimeout(() => {
    open.value = false;
    hasFeedback.value = false;
    updateStateOfCustomerSuccessService();
  }, 500);
}

const handleSetValue = (value: number) => {
  customerSuccessServiceVal.value = value;
};

</script>

<style scoped>
.fade-enter-active, .fade-leave-active {
  transition: all .3s ease;
}

.fade-enter, .fade-leave-to {
  opacity: 0;
  transform: translateY(30px);
}

.fade-leave-active {
  transform: translateY(30px);
}

.fade-no-transform-enter-active, .fade-no-transform-leave-active {
  transition: opacity .3s ease;
}

.fade-no-transform-enter, .fade-no-transform-leave-to {
  opacity: 0;
}
</style>
