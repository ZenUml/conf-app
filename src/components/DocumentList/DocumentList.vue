<template>
  <div class="content">
    <div class="workspace h-screen flex flex-col">
      <header class="flex flex-shrink-0">
        <div class="flex-1 flex items-center justify-between bg-white px-6">
          <nav class="flex text-sm font-medium leading-none text-slate-800">
            <a href="#"
              class="inline-block ml-2 px-3 py-2 hover:bg-gray-200 rounded-lg"
              :class="{ 'bg-gray-200': this.docTypeFilter === '' }"
              @click="setFilter('')">All</a>
            <a href="#"
              class="inline-block ml-2 px-3 py-2 hover:bg-gray-200 rounded-lg"
              :class="{ 'bg-gray-200': this.docTypeFilter === DiagramType.Sequence }"
              @click="setFilter(DiagramType.Sequence)">Sequence</a>
            <a href="#"
              class="inline-block ml-2 px-3 py-2 hover:bg-gray-200 rounded-lg"
              :class="{ 'bg-gray-200': this.docTypeFilter === DiagramType.Mermaid }"
              @click="setFilter(DiagramType.Mermaid)">Mermaid</a>
            <a href="#"
              class="inline-block ml-2 px-3 py-2 hover:bg-gray-200 rounded-lg"
              :class="{ 'bg-gray-200': this.docTypeFilter === DiagramType.Graph }"
              @click="setFilter(DiagramType.Graph)">Graph</a>
            <a href="#"
              class="inline-block ml-2 px-3 py-2 hover:bg-gray-200 rounded-lg"
              :class="{ 'bg-gray-200': this.docTypeFilter === DiagramType.OpenApi }"
              @click="setFilter(DiagramType.OpenApi)">Open API</a>
          </nav>
        </div>
        <div class="w-80 flex-shrink-0 px-4 py-3 bg-white">
          <div class="flex items-center justify-end space-x-2">
            <publish-button :save-and-exit="saveAndExit" />
          </div>
        </div>

      </header>
      <div class="flex-1 flex overflow-hidden">

        <main class="flex bg-gray-200 flex-1">
          <div class="flex flex-col w-full max-w-xs flex-grow border-l border-r">
            <div class="flex flex-shrink-0 items-center px-4 py-2 justify-between border-b">
              <button class="flex items-center text-xs font-semibold text-gray-600">
                Recent diagrams and API specs
              </button>
            </div>
            <div class="flex flex-shrink-0 items-center px-4 py-2 justify-between border-b">
              <input v-model="filterKeyword"
                placeholder="search in title and content"
                class="block p-2 w-full text-sm text-gray-900 bg-gray-50 rounded-lg border border-gray-300 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500">
            </div>
            <div class="flex-1 overflow-y-auto">
              <div v-for="containerPage in filteredPageList"
                :key="containerPage.id"
                class="block px-6 py-3 bg-white border-t hover:bg-gray-50">
                <div class="mt-2 text-sm text-gray-600">
                  <a :href="`${baseUrl}${containerPage.id}`"
                    target="_blank"
                    class="flex items-center justify-between hover:underline group">
                    <span class="inline-block truncate">Page: {{ containerPage.title }}</span>
                    <svg xmlns="http://www.w3.org/2000/svg"
                      class="inline-block h-5 w-5 flex-shrink-0 invisible group-hover:visible"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      stroke-width="2">
                      <path stroke-linecap="round"
                        stroke-linejoin="round"
                        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                </div>

                <a @click="selectDocument(customContentItem)"
                  href="#"
                  v-for="customContentItem in containerPage.customContents"
                  :key="customContentItem.id"
                  :class="{ 'bg-gray-100': customContentItem.id === (picked && picked.id), 'bg-white': customContentItem.id !== (picked && picked.id) }"
                  class="block px-6 py-3 border-t hover:bg-gray-50">
                  <span class="text-sm font-semibold text-gray-900">{{ customContentItem.title }}</span>
                  <div class="flex justify-between">
                    <span class="text-sm font-semibold text-gray-500">{{ customContentItem.value.diagramType }}</span>
                  </div>
                </a>
              </div>
            </div>
          </div>
          <div id="workspace-right"
            class="flex-grow h-full bg-white border-t">
            <component 
              v-if="previewComponent && picked"
              :is="previewComponent"
              :doc="picked"
              :graphXml="picked?.value?.graphXml"
              :code="picked?.value?.code"
              :mermaidCode="picked?.value?.mermaidCode"
              :hideHeader="true"
              class="w-full h-full"
            />
            <div v-else class="flex items-center justify-center h-full text-gray-500">
              Select a document to preview
            </div>
          </div>
        </main>
      </div>
    </div>
  </div>
</template>

<script>
import PublishButton from "@/components/PublishButton.vue";
import { DiagramType, getDiagramData } from "@/model/Diagram/Diagram";
import { loadForgeViewerComponent } from "@/model/Diagram/DiagramTypeConfig";
import EventBus from "@/EventBus";
import { AtlasPage } from "@/model/page/AtlasPage";
import _ from 'lodash';
import { trackEvent } from "@/utils/window";
import { getContext as initForgeContext } from '@/model/globals/forgeGlobal';
import globals from '@/model/globals';
import { setupCloseGuard } from "@/utils/closeGuard";
import { primeCloudId, getCachedCloudId, saveDraftSync } from "@/utils/draftStore";

export default {
  name: 'DocumentList', // for embed-editor
  data() {
    return {
      customContentList: [],
      pageList: [],
      picked: '',
      docTypeFilter: '',
      baseUrl: '',
      filterKeyword: '',
      previewComponentCache: {}, // Cache for loaded components
      sessionOriginalPickedId: null,
      closeGuardOff: null,
    };
  },
  computed: {
    DiagramType() {
      return DiagramType;
    },
    filteredCustomContentList() {
      console.debug(`current filterKeyword: ${this.filterKeyword}`);

      const results = this.customContentList.filter(item => {
        if (!item?.id) {
          return false;
        }
        if (this.docTypeFilter && item?.value?.diagramType?.toLowerCase() !== this.docTypeFilter?.toLowerCase()) {
          return false;
        }
        if (!this.filterKeyword || this.filterKeyword && (
          item.container?.title && item.container?.title.toLowerCase().includes(this.filterKeyword.toLowerCase()) ||
          item.title && item.title.toLowerCase().includes(this.filterKeyword.toLowerCase()) ||
          item.value?.title && item.value?.title.toLowerCase().includes(this.filterKeyword.toLowerCase()) ||
          item.value && getDiagramData(item.value).toLowerCase().includes(this.filterKeyword.toLowerCase())
        )) {
          return true;
        }
        return false;
      });
      console.debug(`filteredCustomContentList:`, results);
      return results;
    },
    filteredPageList() {
      const map = _.groupBy(this.filteredCustomContentList, c => c.container?.id || '0');
      const emptyContainer = { id: '', title: '' };
      const pages = Object.keys(map).map(k => Object.assign({}, map[k][0].container || emptyContainer, { customContents: map[k] }));
      const sorted = _.sortBy(pages, [p => p.title?.toLowerCase()]);
      console.debug(`filteredPageList:`, sorted);
      return sorted;
    },
    previewComponent() {
      if (!this.picked || !this.picked.value?.diagramType) return null;
      return this.previewComponentCache[this.picked.value.diagramType] || null;
    },
    saveAndExit: function () {
      const that = this;
      return function () {
        window.picked = that.picked;
        EventBus.$emit('save-embed', that.picked);
      }
    },
    exit: function () {
      return function () {
        // Track exit from document list with context
        const that = this;
        trackEvent("exit", "document_list", DiagramType.Embed, {
          selected_document: that.picked?.id || null,
          doc_type_filter: that.docTypeFilter,
          source: "document_list_exit"
        });

        EventBus.$emit('exit')
      }
    }
  },
  watch: {
    picked: {
      async handler(newPicked) {
        console.log('DocumentList - picked', newPicked);
        // Capture the initial selection as the baseline for dirty-state detection.
        // `picked` is set asynchronously by initializeForForge/Connect, so we can't
        // capture in mounted(); the first non-empty value is our baseline.
        if (newPicked?.id && this.sessionOriginalPickedId === null) {
          this.sessionOriginalPickedId = newPicked.id;
        }
        if (newPicked && newPicked.value?.diagramType) {
          await this.getPreviewComponentForForge(newPicked.value.diagramType);
        }
      },
      immediate: true
    }
  },
  async mounted() {
    await primeCloudId();
    this._draftScope = 'new:embed';
    this.closeGuardOff = setupCloseGuard(() => {
      if (this.sessionOriginalPickedId === null) return;
      if (this.picked?.id === this.sessionOriginalPickedId) return;
      const cloudId = getCachedCloudId();
      if (cloudId && this.picked?.id) {
        // For embed, the "code" payload is just the selected id. The next
        // mount can offer to restore by pre-selecting it.
        saveDraftSync(this._draftScope, cloudId, {
          code: String(this.picked.id),
          title: '',
        });
      }
    });
  },
  beforeUnmount() {
    this.closeGuardOff?.();
  },
  async created() {
    await this.initializeForForge();

    try {
      const atlasPage = new AtlasPage();
      const pages = 'pages/';
      const currentPageUrl = await atlasPage.getHref();
      const pagesIndex = currentPageUrl.indexOf(pages);
      if (pagesIndex < 0) {
        console.warn(`Invalid currentPageUrl: ${currentPageUrl}. It should contain ${pages}`);
      } else {
        this.baseUrl = currentPageUrl.substring(0, pagesIndex + pages.length);
      }
    } catch (e) {
      console.error(e);
    }
  },
  methods: {
    async initializeForForge() {
      // Forge mode: Get custom content ID from context and load content
      const context = await initForgeContext();
      const customContentId = context.extension?.config?.customContentId;
      
      console.debug(`Forge mode - custom content id: ${customContentId}`);
      
      if (customContentId) {
        // Load the specific custom content
        const customContent = await globals.apWrapper.getCustomContentByIdV2(customContentId);
        console.debug(`Forge mode - loaded custom content:`, customContent);
        
        if (customContent) {
          this.picked = customContent;
          this.selectDocument(customContent);
        }
      }
      
      // Load all custom content for the list
      this.customContentList = await globals.apWrapper.searchCustomContentForge();
      console.debug(`Forge mode - loaded custom content list:`, this.customContentList);
    },

    setFilter(docType) {
      this.docTypeFilter = docType;
    },
    selectDocument(customContentItem) {
      // Update the picked document
      this.picked = customContentItem;
      
      if (this.$store) {
        const diagram = {
          id: customContentItem.id,
          title: customContentItem.title,
          diagramType: customContentItem.value.diagramType,
          code: customContentItem.value.code,
          mermaidCode: customContentItem.value.mermaidCode,
          graphXml: customContentItem.value.graphXml,
          isNew: false,
          ...customContentItem.value
        };

        this.$store.state.diagram = diagram;

        window.diagram = diagram;

        console.log('DocumentList: Updated store with selected document', diagram);
      }
    },
    async getPreviewComponentForForge(diagramType) {
      console.log('getPreviewComponentForForge', diagramType);
      if (this.previewComponentCache[diagramType]) {
        return this.previewComponentCache[diagramType];
      }

      const component = await loadForgeViewerComponent(diagramType);
      if (component) {
        this.previewComponentCache[diagramType] = component;
      }
      return component;
    }
  },
  components: {
    PublishButton,
  }
}
</script>
