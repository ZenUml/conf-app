<template>
  <aside
    v-show="debug"
    role="status"
    aria-label="Debug information"
    class="flex items-center h-9 bg-gray-100 border-b border-gray-300 font-mono text-[11px] leading-none text-gray-600 overflow-x-auto whitespace-nowrap"
  >
    <!-- Environment Info -->
    <div class="inline-flex items-center gap-1.5 px-3 h-full">
      <IconServer class="w-3.5 h-3.5 flex-shrink-0 opacity-60" />
      <span class="text-gray-700 font-normal">{{ app.host }}</span>
    </div>

    <div class="w-px h-5 bg-gray-400 flex-shrink-0"></div>

    <!-- Version Info -->
    <div class="inline-flex items-center gap-1.5 px-3 h-full">
      <IconGitBranch class="w-3.5 h-3.5 flex-shrink-0 opacity-60" />
      <span class="text-gray-700 font-normal">{{ gitBranch || gitTag }}:{{ commitHash }}</span>
    </div>

    <div class="w-px h-5 bg-gray-400 flex-shrink-0"></div>

    <!-- Content Info -->
    <div class="inline-flex items-center gap-1.5 px-3 h-full">
      <IconFile class="w-3.5 h-3.5 flex-shrink-0 opacity-60" />
      <span class="text-gray-700 font-normal uppercase">[{{ shortUuid || 'N/A' }}]:{{ shortContentId }}</span>
    </div>

    <div class="w-px h-5 bg-gray-400 flex-shrink-0"></div>

    <!-- Feature Flag Status (Mockable) -->
    <button
      @click="toggleCSS"
      :class="[
        'inline-flex items-center gap-1.5 px-3 h-full font-semibold border-none bg-transparent cursor-pointer transition-all duration-150 rounded hover:bg-black/5 hover:scale-105 active:scale-95',
        customerSuccessEnabled ? 'text-green-500' : 'text-gray-400'
      ]"
      :title="'Click to toggle CSS Feature Flag (currently ' + (customerSuccessEnabled ? 'ON' : 'OFF') + ')'"
    >
      <span
        :class="[
          'inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-bold flex-shrink-0',
          customerSuccessEnabled ? 'bg-green-500 text-white' : 'bg-gray-300 text-gray-600'
        ]"
      >{{ customerSuccessEnabled ? '✓' : '✕' }}</span>
      <span class="font-normal">{{ customerSuccessEnabled ? 'ON' : 'OFF' }}</span>
    </button>

    <div class="w-px h-5 bg-gray-400 flex-shrink-0"></div>

    <!-- isLite Mock Toggle -->
    <button
      @click="toggleIsLite"
      :class="[
        'inline-flex items-center gap-1.5 px-3 h-full font-semibold border-none bg-transparent cursor-pointer transition-all duration-150 rounded hover:bg-black/5 hover:scale-105 active:scale-95',
        isLiteMocked ? 'text-blue-500' : 'text-gray-400'
      ]"
      :title="'Click to toggle isLite mock (currently ' + (isLiteMocked ? 'LITE' : 'FULL') + ')'"
    >
      <span
        :class="[
          'inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-bold flex-shrink-0',
          isLiteMocked ? 'bg-blue-500 text-white' : 'bg-gray-300 text-gray-600'
        ]"
      >{{ isLiteMocked ? 'L' : 'F' }}</span>
      <span class="font-normal">{{ isLiteMocked ? 'LITE' : 'FULL' }}</span>
    </button>

    <div class="w-px h-5 bg-gray-400 flex-shrink-0"></div>

    <!-- Testing Tools -->
    <div class="inline-flex items-center gap-2 px-3 h-full bg-purple-50/50">
      <span class="text-gray-700 font-normal">🧪</span>
      <input
        type="number"
        v-model.number="mockMacroCount"
        @change="applyMock"
        class="w-16 h-6 px-2 border border-gray-300 rounded text-[11px] font-mono bg-white text-gray-700 transition-colors focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-100 placeholder:text-gray-300"
        placeholder="auto"
        min="0"
        max="200"
      />
      <button
        @click="clearAll"
        class="h-6 px-3 border-none rounded text-[11px] font-medium font-mono cursor-pointer transition-all duration-150 bg-gray-200 text-gray-600 hover:bg-gray-300 active:bg-gray-400 active:text-white"
        title="Clear all mocks and reload"
      >
        Clear
      </button>
    </div>
  </aside>
</template>

<script>
import App from "@/model/app/App";
import {MacroIdProvider} from "@/model/ContentProvider/MacroIdProvider";
import AP from "@/model/AP";
import ApWrapper2 from "@/model/ApWrapper2";
import IconServer from "@/components/icons/IconServer.vue";
import IconGitBranch from "@/components/icons/IconGitBranch.vue";
import IconFile from "@/components/icons/IconFile.vue";
import getFeatureFlagsForCurrentDomain from "@/apis/featureFlags";

const commitHash = import.meta.env.VITE_APP_GIT_HASH;
const gitBranch = import.meta.env.VITE_APP_GIT_BRANCH;
const gitTag = import.meta.env.VITE_APP_GIT_TAG;
export default {
  name: "Debug",
  components: {
    IconServer,
    IconGitBranch,
    IconFile
  },
  data() {
    return {
      commitHash,
      gitBranch,
      gitTag,
      shortUuid: '',
      contentId: '',
      mockMacroCount: localStorage.mockMacroCount ? parseInt(localStorage.mockMacroCount) : null,
      customerSuccessEnabled: this.getInitialCSSState()
    }
  },
  methods: {
    getInitialCSSState() {
      // Check localStorage first (mock), then will load from API
      if (localStorage.mockCSSEnabled !== undefined) {
        return localStorage.mockCSSEnabled === 'true'
      }
      return false // Will be updated by API call in mounted()
    },
    applyMock() {
      if (this.mockMacroCount !== null && this.mockMacroCount >= 0) {
        localStorage.mockMacroCount = this.mockMacroCount
        console.log('🧪 Mock macro count set to:', this.mockMacroCount)
        window.location.reload()
      } else if (this.mockMacroCount === null || this.mockMacroCount === '') {
        delete localStorage.mockMacroCount
        console.log('🧪 Mock macro count cleared')
        window.location.reload()
      }
    },
    toggleCSS() {
      this.customerSuccessEnabled = !this.customerSuccessEnabled
      localStorage.mockCSSEnabled = this.customerSuccessEnabled
      console.log('🧪 Mock CSS Feature Flag set to:', this.customerSuccessEnabled)
      window.location.reload()
    },
    toggleIsLite() {
      const url = new URL(window.location.href)

      if (this.isLiteMocked) {
        // Currently LITE, switch to FULL
        url.searchParams.set('addonKey', 'com.zenuml.confluence-addon')
        console.log('🧪 Switching to FULL mode (addonKey: com.zenuml.confluence-addon)')
      } else {
        // Currently FULL, switch to LITE
        url.searchParams.set('addonKey', 'com.zenuml.confluence-addon-lite')
        console.log('🧪 Switching to LITE mode (addonKey: com.zenuml.confluence-addon-lite)')
      }

      window.location.href = url.toString()
    },
    clearAll() {
      delete localStorage.mockMacroCount
      delete localStorage.mockCSSEnabled

      // Clear addonKey from URL
      const url = new URL(window.location.href)
      url.searchParams.delete('addonKey')

      this.mockMacroCount = null
      console.log('🧪 All mocks cleared')
      window.location.href = url.toString()
    }
  },
  computed: {
    debug() {
      return !!localStorage.zenumlDebug;
    },
    app() {
      return new App();
    },
    shortContentId() {
      if (!this.contentId) return 'N/A';
      if (this.contentId.length <= 5) return this.contentId;
      return `..${this.contentId.slice(-5)}`;
    },
    isLiteMocked() {
      const urlParams = new URLSearchParams(window.location.search)
      const addonKey = urlParams.get('addonKey') || 'com.zenuml.confluence-addon'
      return addonKey.includes('lite')
    }
  },
  async mounted() {
    const macroIdProvider = new MacroIdProvider(new ApWrapper2(AP));
    this.shortUuid = (await macroIdProvider.getUuid())?.substring(0, 8);
    this.contentId = await macroIdProvider.getId();

    // Load customer success service feature flag (if not mocked)
    if (localStorage.mockCSSEnabled === undefined) {
      try {
        const flags = await getFeatureFlagsForCurrentDomain(['CUSTOMER_SUCCESS_SERVICE']);
        this.customerSuccessEnabled = !!flags.CUSTOMER_SUCCESS_SERVICE;
      } catch (error) {
        console.error('Failed to load customer success feature flag:', error);
      }
    } else {
      console.log('🧪 Using mocked CSS Feature Flag:', this.customerSuccessEnabled);
    }
  }
}
</script>