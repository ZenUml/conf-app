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
            <close-button :exit="exit" />
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
            <!-- Dynamic preview component for Forge mode -->
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
            <!-- Fallback iframe for Connect mode -->
            <iframe 
              v-else-if="previewSrc"
              id='embedded-viewer'
              :src='previewSrc'
              width='100%'
              height='100%'>
            </iframe>
            <!-- Loading state -->
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
import CloseButton from "@/components/CloseButton.vue";
import { DiagramType, getDiagramData } from "@/model/Diagram/Diagram";
import EventBus from "@/EventBus";
import { AtlasPage } from "@/model/page/AtlasPage";
import AP from "@/model/AP";
import { MacroIdProvider } from "@/model/ContentProvider/MacroIdProvider";
import { CustomContentStorageProvider } from "@/model/ContentProvider/CustomContentStorageProvider";
import ApWrapper2 from "@/model/ApWrapper2";
import _ from 'lodash';
import { trackEvent } from "@/utils/window";
import { getContext as initForgeContext } from '@/model/globals/forgeGlobal';

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
      previewComponentCache: {} // Cache for loaded components
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
    previewSrc() {
      if (!this.picked) return;
      function getViewerUrl(diagramType) {
        if (diagramType === DiagramType.Sequence || diagramType === DiagramType.Mermaid) {
          return '/sequence-viewer.html';
        }
        if (diagramType === DiagramType.Graph) {
          return '/drawio/viewer.html';
        }
        if (diagramType === DiagramType.OpenApi) {
          return '/swagger-ui.html';
        }

        console.warn(`Unknown diagramType: ${diagramType}`);
      }
      return `${getViewerUrl(this.picked.value.diagramType)}${window.location.search || '?'}&rendered.for=custom-content-native&content.id=${this.picked.id}&embedded=true`;
    },
    previewComponent() {
      if (!this.picked || !this.picked.value?.diagramType) return null;
      
      // Check if we're in Forge mode
      if (window.forgeGlobal?.isForge) {
        // Return cached component if available
        return this.previewComponentCache[this.picked.value.diagramType] || null;
      }
      
      return null;
    },
    saveAndExit: function () {
      const that = this;
      return function () {
        window.picked = that.picked;
        EventBus.$emit(window.forgeGlobal?.isForge ? 'save-embed' : 'save', that.picked);
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
        if (newPicked && newPicked.value?.diagramType && window.forgeGlobal?.isForge) {
          // Load the preview component when picked item changes
          await this.getPreviewComponentForForge(newPicked.value.diagramType);
        }
      },
      immediate: true
    }
  },
  async created() {
    if (window.forgeGlobal?.isForge) {
      // Forge mode: Use Forge context and API
      await this.initializeForForge();
    } else {
      // Connect mode: Use Connect providers
      await this.initializeForConnect();
    }

    try {
      const atlasPage = new AtlasPage(AP);
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
      this.customContentList = (await globals.apWrapper.searchPagedCustomContentForge(250, '', false, '', [], true)).results;
      console.debug(`Forge mode - loaded custom content list:`, this.customContentList);
    },
    
    async initializeForConnect() {
      // Connect mode: Use Connect providers
      const apWrapper = new ApWrapper2(AP);
      const idProvider = new MacroIdProvider(apWrapper);
      const customContentStorageProvider = new CustomContentStorageProvider(apWrapper);
      const customContentId = await idProvider.getId();
      console.debug(`Connect mode - picked custom content id: ${customContentId}`);
      this.customContentList = await customContentStorageProvider.getCustomContentList();
      this.picked = this.customContentList.filter(customContentItem => customContentItem?.id === customContentId)[0];
      console.debug(`Connect mode - picked custom content:`, this.picked);
    },
    
    setFilter(docType) {
      this.docTypeFilter = docType;
    },
    selectDocument(customContentItem) {
      // Update the picked document
      this.picked = customContentItem;
      
      // Update the store state for Forge mode
      if (window.forgeGlobal?.isForge && this.$store) {
        // Convert the custom content item to diagram format and update store
        const diagram = {
          id: customContentItem.id,
          title: customContentItem.title,
          diagramType: customContentItem.value.diagramType,
          code: customContentItem.value.code,
          mermaidCode: customContentItem.value.mermaidCode,
          graphXml: customContentItem.value.graphXml,
          isNew: false,
          // Add any other properties that might be needed
          ...customContentItem.value
        };
        
        // Update the store state
        this.$store.state.diagram = diagram;
        
        // Also update window.diagram for compatibility
        window.diagram = diagram;
        
        console.log('DocumentList: Updated store with selected document', diagram);
      }
    },
    async getPreviewComponentForForge(diagramType) {
      console.log('getPreviewComponentForForge', diagramType);
      // Return cached component if available
      if (this.previewComponentCache[diagramType]) {
        return this.previewComponentCache[diagramType];
      }

      try {
        let component = null;
        
        if (diagramType === DiagramType.Sequence || diagramType === DiagramType.Mermaid) {
          // Import sequence viewer components
          const { default: DiagramPortal } = await import('@/components/DiagramPortal.vue');
          component = DiagramPortal;
        } else if (diagramType === DiagramType.Graph) {
          // Import Forge-specific graph viewer component for embed
          const { default: ForgeGraphViewerEmbed } = await import('@/components/Viewer/ForgeGraphViewerEmbed.vue');
          component = ForgeGraphViewerEmbed;
        } else if (diagramType === DiagramType.OpenApi) {
          // Import Forge-specific OpenAPI viewer component
          const { default: ForgeOpenApiViewer } = await import('@/components/Viewer/ForgeOpenApiViewer.vue');
          component = ForgeOpenApiViewer;
        }

        // Cache the component for future use
        if (component) {
          this.previewComponentCache[diagramType] = component;
        }

        return component;
      } catch (e) {
        console.error('Failed to load preview component for type:', diagramType, e);
        return null;
      }
    }
  },
  components: {
    PublishButton,
    CloseButton,
  }
}
</script>
