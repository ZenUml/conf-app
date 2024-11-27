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
      <!-- Usage Status with Chart Icon -->
      <div class="flex items-center gap-2 font-medium">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-blue-400" viewBox="0 0 20 20" fill="currentColor">
          <path d="M2 10a8 8 0 018-8v8h8a8 8 0 11-16 0z" />
          <path d="M12 2.252A8 8 0 0112 18.251V10H3.751A8 8 0 0112 2.252z" />
        </svg>
        <div class="text-blue-400">
          Space macro usage:
          <span class="text-white">{{ macrosCreated }}</span>
          <span class="text-gray-400">/</span>
          <span class="text-yellow-400 bg-yellow-400/10 px-1.5 py-0.5 rounded">
              {{ macrosLimit }}
            </span>
        </div>
      </div>

      <!-- Value Stats with Icons -->
      <div class="mt-3 space-y-2 text-sm">
        <div class="flex items-start gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 mt-0.5 text-blue-400 shrink-0" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clip-rule="evenodd" />
          </svg>
          <span class="text-gray-300">Saved <span class="text-blue-400 font-medium">~{{ Math.round(macrosCreated * 30 / 60) }} hours</span> on diagram creation and updates</span>
        </div>
        <div class="flex items-start gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 mt-0.5 text-blue-400 shrink-0" viewBox="0 0 20 20" fill="currentColor">
            <path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z" />
          </svg>
          <span class="text-gray-300">Streamline team collaboration with consistent, professional diagrams</span>
        </div>
      </div>

      <!-- Upcoming Changes with Warning Icon -->
      <div class="mt-4 flex items-start gap-2 text-sm">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 mt-0.5 text-yellow-400 shrink-0" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
        </svg>
        <div class="text-gray-300">
          Starting March 1, 2025, free tier spaces will be limited to
          <span class="font-medium text-yellow-400 bg-yellow-400/10 px-1.5 py-0.5 rounded">{{ macrosLimit }}</span> macros
        </div>
      </div>

      <!-- Access Info with Check/Lock Icons -->
      <div class="mt-3 space-y-2 text-sm">
        <div class="flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-green-400 shrink-0" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
          </svg>
          <span class="text-green-400">Viewing remains unlimited</span>
        </div>
        <div class="flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-gray-300 shrink-0" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clip-rule="evenodd" />
          </svg>
          <span class="text-gray-300">Upgrade needed for creating new or editing existing macros</span>
        </div>
      </div>

      <!-- Discount with Timer Icon -->
      <div class="mt-3 flex items-center gap-2 text-sm">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-green-400 shrink-0" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clip-rule="evenodd" />
        </svg>
        <p class="text-green-400">Lock in up to <span class="font-bold">50%</span> discount if you pay by December 31, 2024</p>
      </div>

      <!-- Upgrade Button -->
      <div class="mt-4">
          <span class="inline-flex items-center gap-1 text-sm font-medium text-blue-400 hover:text-blue-300 transition-colors duration-200">
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
