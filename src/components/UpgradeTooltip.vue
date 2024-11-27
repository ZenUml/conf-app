<template>
    <div
      class="invisible group-hover:visible absolute left-0 w-96 z-50"
      style="top: calc(100% - 5px);"
    >
      <div class="h-3 w-full"></div>
  
      <div class="w-full">
        <a
          class="block p-4 rounded-lg bg-gray-900 text-white shadow-lg hover:shadow-xl transition-shadow duration-200"
          :href="upgradeUrl"
          target="_blank"
          rel="noopener noreferrer"
          @click="$emit('click')"
        >
          <!-- Usage Status - Redesigned -->
          <div class="font-medium text-blue-400">
            Space macro usage:
            <span class="text-white">{{ macrosCreated }}</span>
            <span class="text-gray-400">/</span>
            <span class="text-yellow-400 bg-yellow-400/10 px-1.5 py-0.5 rounded">
              {{ macrosLimit }}
            </span>
          </div>
  
          <!-- Main Message -->
          <div class="mt-2 text-sm text-gray-300">
            Starting March 1, 2025, free tier spaces will be limited to <span
              class="font-medium text-yellow-400 bg-yellow-400/10 px-1.5 py-0.5 rounded">
              {{ macrosLimit }}
            </span> macros.
          </div>
  
          <!-- Action Message -->
          <div class="mt-2 text-sm">
            <span class="text-green-400">Viewing remains unlimited.</span>
            <span class="text-gray-300"> Upgrade needed for creating new or editing existing macros.</span>
            <p class="text-green-400">Lock in up to a <span class="font-bold">50%</span> discount if you pay by
              December 31, 2024.</p>
          </div>
  
          <!-- Upgrade Button -->
          <div class="mt-3">
            <span
              class="inline-flex items-center gap-1 text-sm font-medium text-blue-400 hover:text-blue-300 transition-colors duration-200">
              Upgrade now
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="w-4 h-4"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fill-rule="evenodd"
                  d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z"
                  clip-rule="evenodd"
                />
              </svg>
            </span>
          </div>
        </a>
      </div>
    </div>
  </template>
  
  <script setup lang="ts">
  defineProps<{
    macrosCreated: number
    macrosLimit: number
    upgradeUrl: string
  }>()
  
  defineEmits<{
    (e: 'click'): void
  }>()
  </script>