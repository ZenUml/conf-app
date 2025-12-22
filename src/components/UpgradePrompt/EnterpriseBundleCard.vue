<template>
  <div class="p-4 bg-gray-50 flex flex-col">
    <h3 class="text-base font-bold text-gray-900 mb-3">Enterprise Bundle</h3>

    <!-- Best For -->
    <div class="bg-gray-50 rounded p-2 mb-3 border border-gray-300">
      <div class="flex items-start gap-1.5 text-xs text-gray-700">
        <span class="text-gray-600">💡</span>
        <div>
          <span class="font-semibold">Best for:</span> Large user base but only a few spaces heavily use this app
        </div>
      </div>
    </div>

    <!-- Features -->
    <div class="space-y-1.5 mb-3 text-xs text-gray-700">
      <div class="flex gap-1.5">
        <span class="text-green-600">✓</span>
        <span>Unlimited macros and unlimited users (this space)</span>
      </div>
      <div class="flex gap-1.5">
        <span class="text-green-600">✓</span>
        <span>Enterprise plan for https://app.zenuml.com</span>
      </div>
      <div class="flex gap-1.5">
        <span class="text-green-600">✓</span>
        <span>Plus plan for https://diagramly.ai</span>
      </div>
      <div class="flex gap-1.5">
        <span class="text-green-600">✓</span>
        <span><span class="font-semibold">No Confluence Admin permission required</span></span>
      </div>
    </div>

    <!-- Spacer to push content to bottom -->
    <div class="flex-grow"></div>

    <!-- Pricing Box -->
    <div class="bg-gray-50 rounded p-2 mb-3 border border-gray-300">
      <div class="text-xs text-gray-500 mt-1">
        Only if the space has more than {{ ENTERPRISE_BUNDLE_MIN_MACROS }} macros
      </div>
      <div class="flex items-baseline justify-between">
        <div class="text-2xl font-bold text-gray-900 tabular-nums">
          Unlimited<span class="text-sm font-normal text-gray-600"> users</span>
        </div>
        <div class="text-2xl font-bold text-gray-900 tabular-nums">
          ${{ ENTERPRISE_BUNDLE_ANNUAL_COST }}<span class="text-sm font-normal text-gray-600">/yr/space</span>
        </div>
      </div>
      <div class="text-xs text-gray-500 mt-2">
        For multiple spaces, <a href="https://zenuml.atlassian.net/servicedesk/customer/portals" target="_blank" rel="noopener noreferrer" class="text-blue-600 hover:underline">submit a ticket</a> or email <a href="mailto:support@zenuml.com" class="text-blue-600 hover:underline">support@zenuml.com</a>.
      </div>
    </div>

    <!-- CTA Button -->
    <a
      :href="bundleUrl"
      target="_blank"
      rel="noopener noreferrer"
      @click="$emit('cta-click')"
      class="block w-full bg-gray-700 hover:bg-gray-800 text-white text-center font-semibold py-2 px-3 rounded text-sm transition-colors duration-200"
    >
      Get Bundle →
    </a>
  </div>
</template>

<script setup lang="ts">
import { ENTERPRISE_BUNDLE_ANNUAL_COST, ENTERPRISE_BUNDLE_MIN_MACROS } from './upgradePrompt'

defineProps<{
  bundleUrl: string
}>()

defineEmits<{
  (e: 'cta-click'): void
}>()
</script>
