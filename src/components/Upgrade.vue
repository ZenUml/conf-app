<template>
    <a class="discussion p-1 flex justify-center items-center rounded bg-blue-600" @click="trackClickEvent"
       target="_blank" href="https://zenuml.com/upgrade/">
      <span class="px-1 text-xs text-white">Upgrade</span>
    </a>
</template>

<script>
import {trackEvent} from "@/utils/window";
export default {
  name: "SendFeedback",
  methods: {
    trackClickEvent() {
      trackEvent('upgrade', 'click', 'conversion');
    }
  }
}
</script>
