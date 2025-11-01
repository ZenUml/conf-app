<template>
  <aside v-show="debug" role="status" aria-label="Debug information" class="debug flex flex-wrap text-xs">
      <div class="inline-flex items-center px-3 py-1 bg-blue-200 text-blue-700" aria-label="Server host">
        <IconServer class="w-5 h-5" />
        <span class="inline-block px-2">{{ app.host }}</span>
      </div>
      <div class="inline-flex items-center px-3 py-1 bg-green-200 text-green-700" aria-label="Git version">
        <IconGitBranch class="w-5 h-5" />
        <span class="inline-block px-2">{{ gitBranch || gitTag }}:{{ commitHash }}</span>
      </div>
      <div class="inline-flex items-center uppercase px-3 py-1 bg-yellow-200 text-yellow-700" aria-label="Macro information">
        <IconFile class="w-5 h-5" />
        <span class="inline-block px-2">[{{ shortUuid || 'macro uuid' }}]:{{ contentId }}</span>
      </div>
      <div class="inline-flex items-center px-3 py-1 bg-purple-200 text-purple-700" aria-label="Mock macro count">
        <span class="mr-2">🧪 Mock Macros:</span>
        <input 
          type="number" 
          v-model.number="mockMacroCount" 
          class="w-20 px-2 border rounded text-xs"
          placeholder="auto"
          min="0"
          max="200"
        />
        <button 
          @click="applyMock" 
          class="ml-2 px-2 py-0.5 bg-purple-600 text-white rounded text-xs hover:bg-purple-700"
        >
          Apply
        </button>
        <button 
          @click="clearMock" 
          class="ml-1 px-2 py-0.5 bg-gray-600 text-white rounded text-xs hover:bg-gray-700"
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
      mockMacroCount: localStorage.mockMacroCount ? parseInt(localStorage.mockMacroCount) : null
    }
  },
  methods: {
    applyMock() {
      if (this.mockMacroCount !== null && this.mockMacroCount >= 0) {
        localStorage.mockMacroCount = this.mockMacroCount
        console.log('🧪 Mock macro count set to:', this.mockMacroCount)
        window.location.reload()
      }
    },
    clearMock() {
      delete localStorage.mockMacroCount
      this.mockMacroCount = null
      console.log('🧪 Mock macro count cleared')
      window.location.reload()
    }
  },
  computed: {
    debug() {
      return !!localStorage.zenumlDebug;
    },
    app() {
      return new App();
    },
  },
  async mounted() {
    const macroIdProvider = new MacroIdProvider(new ApWrapper2(AP));
    this.shortUuid = (await macroIdProvider.getUuid())?.substring(0, 8);
    this.contentId = await macroIdProvider.getId();
  }
}
</script>

<style scoped>

</style>