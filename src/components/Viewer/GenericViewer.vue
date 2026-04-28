<template>
<!-- screen-capture-content class is used in Attachment.js to select the node. -->
<div class="generic viewer">
  <Debug />
  <error-boundary>
    <div class="frame relative" :class="{'w-full': wide, 'w-fit mx-auto': !wide}">
      <div class="header flex items-center justify-between px-4 py-2 border-b border-gray-200" :class="[headerBgClass, {'app-indicator': !isProduction, flex: isDisplayMode && !hideHeader, hidden: !isDisplayMode || hideHeader}]" :data-app="appType">
        <!-- Left: Primary & Secondary Actions -->
        <div class="flex items-center gap-2">
          <!-- Embedded Badge -->
          <div v-show="isEmbedded" class="flex justify-center items-center">
            <span class="px-2 py-1 text-xs font-semibold text-gray-500 bg-gray-100 rounded cursor-help" title="content is embedded from another page">Embedded</span>
          </div>

          <!-- P0: Fullscreen (Most clicked - Blue solid) -->
          <button @click="fullscreen" aria-label="Fullscreen"
                  class="inline-flex items-center gap-1.5 px-3 py-1.5
                         bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium
                         rounded-md transition-colors duration-200">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
              </svg>
              <span>Fullscreen</span>
            </button>

          <!-- P1: Edit (Core function - Blue outline) -->
          <button @click="edit" v-show="showEdit" aria-label="Edit"
                  class="inline-flex items-center gap-1.5 px-3 py-1.5
                         border-2 border-blue-600 text-blue-600 hover:bg-blue-50
                         text-sm font-medium rounded-md transition-colors duration-200">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                <path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
              </svg>
              <span>Edit</span>
            </button>

          <!-- P2: Common Tools (Gray buttons with labels) -->
          <div class="flex items-center gap-2 ml-2 pl-2 border-l border-gray-200">

            <!-- Heroicons: camera -->
            <button @click="showExportModal = true" aria-label="Download PNG"
                    class="inline-flex items-center gap-1.5 px-3 py-1.5
                           border border-gray-300 text-gray-700 hover:bg-gray-50
                           text-xs font-medium rounded-md transition-colors duration-200">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
                <path stroke-linecap="round" stroke-linejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM18.75 10.5h.008v.008h-.008V10.5Z" />
              </svg>
              <span>Export</span>
            </button>

            <!-- Copy Code button -->
            <button @click="copyCode" aria-label="Copy Code"
                    class="inline-flex items-center gap-1.5 px-3 py-1.5
                           border border-gray-300 text-gray-700 hover:bg-gray-50
                           text-xs font-medium rounded-md transition-colors duration-200 whitespace-nowrap">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" />
              </svg>
              <span>Copy Code</span>
            </button>

            <!-- Heroicons: clock -->
            <button v-show="isCustomContent" @click="showContentVersions" aria-label="Versions"
                    class="inline-flex items-center gap-1.5 px-3 py-1.5
                           border border-gray-300 text-gray-700 hover:bg-gray-50
                           text-xs font-medium rounded-md transition-colors duration-200 relative">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
              <span>Versions</span>
              <!-- Quick popup tooltip -->
              <div v-if="showVersionsTooltip" class="absolute z-10 bg-gray-700 text-white text-xs rounded py-1 px-2 left-1/2 transform -translate-x-1/2 mt-1 whitespace-nowrap shadow-md">
                Version history shown in developer console (F12)
                <div class="absolute w-2 h-2 bg-gray-700 transform rotate-45 -top-1 left-1/2 -translate-x-1/2"></div>
              </div>
            </button>
          </div>
        </div>

        <!-- Right: Social & Conversion -->
        <div class="flex items-center gap-2">
          <!-- P4: Social helpers (Light gray) -->
          <div class="flex items-center gap-1">
            <send-feedback/>

            <button @click="clickLikeButton"
                    class="inline-flex items-center gap-1 px-2 py-1.5 rounded-md hover:bg-gray-50 text-sm transition-colors duration-200"
                    title="Like this diagram">
              <IconLikeFilled v-if="userLiked" :width="16" class="text-blue-600"/>
              <IconLike v-else :width="16" class="text-gray-400"/>
              <span :class="userLiked ? 'text-blue-600' : 'text-gray-500'">{{ likesForDisplay }}</span>
            </button>
          </div>

          <!-- P3: Conversion CTA (Gold gradient - Most eye-catching) - Only for Lite with 50+ macros and not paid -->
          <div v-if="isLite && macrosCreated > 50 && !spacePaid" class="ml-2 pl-2 border-l border-gray-200">
            <button @click="openUpgradeModal"
                    class="inline-flex items-center gap-1.5 px-3 py-1.5
                           bg-gradient-to-r from-amber-500 to-orange-600
                           hover:from-amber-600 hover:to-orange-700
                           text-white text-sm font-semibold rounded-md
                           shadow-md hover:shadow-lg transform hover:scale-105
                           transition-all duration-200"
                    title="Upgrade to unlock unlimited diagrams">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-4 h-4">
                <path fill-rule="evenodd" d="M9 4.5a.75.75 0 0 1 .721.544l.813 2.846a3.75 3.75 0 0 0 2.576 2.576l2.846.813a.75.75 0 0 1 0 1.442l-2.846.813a3.75 3.75 0 0 0-2.576 2.576l-.813 2.846a.75.75 0 0 1-1.442 0l-.813-2.846a3.75 3.75 0 0 0-2.576-2.576l-2.846-.813a.75.75 0 0 1 0-1.442l2.846-.813A3.75 3.75 0 0 0 7.466 7.89l.813-2.846A.75.75 0 0 1 9 4.5ZM18 1.5a.75.75 0 0 1 .728.568l.258 1.036c.236.94.97 1.674 1.91 1.91l1.036.258a.75.75 0 0 1 0 1.456l-1.036.258c-.94.236-1.674.97-1.91 1.91l-.258 1.036a.75.75 0 0 1-1.456 0l-.258-1.036a2.625 2.625 0 0 0-1.91-1.91l-1.036-.258a.75.75 0 0 1 0-1.456l1.036-.258a2.625 2.625 0 0 0 1.91-1.91l.258-1.036A.75.75 0 0 1 18 1.5ZM16.5 15a.75.75 0 0 1 .712.513l.394 1.183c.15.447.5.799.948.948l1.183.395a.75.75 0 0 1 0 1.422l-1.183.395c-.447.15-.799.5-.948.948l-.395 1.183a.75.75 0 0 1-1.422 0l-.395-1.183a1.5 1.5 0 0 0-.948-.948l-1.183-.395a.75.75 0 0 1 0-1.422l1.183-.395c.447-.15.799-.5.948-.948l.395-1.183A.75.75 0 0 1 16.5 15Z" clip-rule="evenodd" />
              </svg>
              <span>Upgrade</span>
            </button>
          </div>
        </div>
      </div>
      <div class="screen-capture-content" :class="{'w-full': wide}">
        <slot></slot>
      </div>
    </div>
  </error-boundary>
  
  <UpgradePromptRouter
    :visible="showUpgradeModal"
    :macros-created="macrosCreated"
    :macros-limit="MACROS_LIMIT"
    :upgrade-url="upgradeUrl"
    :enterprise-bundle-url="enterpriseBundleUrl"
    :space-key="currentSpaceKey"
    @close="showUpgradeModal = false"
  />
  <ExportModal :visible="showExportModal" @close="showExportModal = false" />
</div>
</template>

<script>
import {trackEvent} from "@/utils/window";
import { saveAs } from 'file-saver';

import {mapState, mapGetters} from "vuex";
import EventBus from '../../EventBus'
import Debug from '@/components/Debug/Debug.vue'
import ErrorBoundary from "@/components/ErrorBoundary.vue";
import globals from '@/model/globals';
import {DataSource} from "@/model/Diagram/Diagram";
import { getCodeFromDiagram } from "@/model/Diagram/DiagramTypeConfig";
import {isEmbedMode} from '@/utils/isEmbedMode';
import {getClientDomain} from '@/utils/ContextParameters/ContextParameters';
import SendFeedback from "@/components/SendFeedback.vue";
import UpgradePromptRouter from '@/components/UpgradePrompt/UpgradePromptRouter.vue'
import ExportModal from '@/components/ExportModal/ExportModal.vue'
import * as htmlToImage from "html-to-image";
import { toggleDiagramLike, getDiagramLikes } from "@/services/DiagramLikes";
import store from "@/model/store2";
import IconLike from "../icons/IconLike.vue";
import IconLikeFilled from "../icons/IconLikeFilled.vue";
import { useCustomerSuccessService, MACROS_LIMIT, getUpgradeContext } from '@/composables/useCustomerSuccessService'
import { trackUpgradeEvent, UpgradeEventName, UIComponent } from '@/utils/upgradeTracking'
import { toast } from '@/utils/toast'

export default {
  name: "GenericViewer",
  props: ['wide', 'hideHeader'],
  data: () => {
    const { macrosCreated, severity, shouldBlockActions, upgradeUrl, enterpriseBundleUrl, initialize, spacePaid } = useCustomerSuccessService()

    return {
      canUserEdit: true,
      userLiked: false,
      likesCount: 0,
      isLikeInFlight: false,
      showVersionsTooltip: false,
      versionsTooltipTimer: null,
      showUpgradeModal: false,
      showExportModal: false,
      currentSpaceKey: '',
      macrosCreated,
      severity,
      shouldBlockActions,
      upgradeUrl,
      enterpriseBundleUrl,
      MACROS_LIMIT,
      spacePaid,
      initializeCustomerSuccess: initialize
    }
  },
  components: {
    SendFeedback,
    Debug,
    ErrorBoundary,
    UpgradePromptRouter,
    ExportModal,
    IconLike,
    IconLikeFilled,
  },
  computed: {
    // We use {} instead of [] to get type checking
    ...mapState({diagramType: state => state.diagram.diagramType, diagram: state => state.diagram }),
    ...mapGetters({isDisplayMode: 'isDisplayMode'}),
    isLite() {
      return globals.apWrapper.isLite();
    },
    isEmbedded() {
      return isEmbedMode();
    },
    isCustomContent() {
      return this.diagram.source === DataSource.CustomContent;
    },
    headerBgClass() {
      const envType = window.forgeGlobal?.forgeContext?.environmentType;
      const host = window.location.host;

      if (envType === 'DEVELOPMENT' && host === 'localhost:8000') return 'bg-amber-200';
      if (envType === 'DEVELOPMENT') return 'bg-emerald-200';
      if (envType === 'STAGING') return 'bg-violet-200';
      return 'bg-white';
    },
    showEdit() {
      // Development environment: always show edit button
      if (import.meta.env.DEV) {
        console.debug('showEdit (DEV mode): true');
        return true;
      }

      // Production: check permissions
      let isCustomContent = this.diagram.source === DataSource.CustomContent;
      let isNotCopy = !this.diagram.isCopy;
      console.debug('showEdit', this.canUserEdit, isCustomContent, isNotCopy);
      return this.canUserEdit && isCustomContent && isNotCopy;
    },
    likesForDisplay() {
      return this.likesCount > 0 ? this.likesCount : '';
    },
    isMoonactive() {
      return getClientDomain() === 'moonactive';
    },
    appType() {
      const productType = import.meta.env.PRODUCT_TYPE;
      if (productType === 'diagramly') return 'diagramly';
      if (productType === 'lite') return 'lite';
      return 'full';
    },
    isProduction() {
      const envType = window.forgeGlobal?.forgeContext?.environmentType;
      return !envType || envType === 'PRODUCTION';
    },
  },
  async mounted() {
    try {
      this.canUserEdit = await globals.apWrapper.canUserEdit();
      await this.getLikes();
      await this.initializeCustomerSuccess();
      try {
        this.currentSpaceKey = (await globals.apWrapper.getCurrentSpace())?.key || '';
      } catch (e) {
        // ignore — spaceKey is optional for the router
      }
    } catch (e) {
console.error('Error getting feature flags', e);
    }
  },
  methods: {
    edit() {
      trackEvent('edit', 'click', 'editing');

      // Block if critical (100+ macros) AND feature flag enabled
      if (this.shouldBlockActions) {
        this.showUpgradeModal = true

        // Track ACTION_BLOCKED event
        trackUpgradeEvent(UpgradeEventName.ACTION_BLOCKED, {
          ui_component: UIComponent.VIEWER_NOTICE,
          action_type: 'edit',
          ...getUpgradeContext(),
        })
        return  // Block the action
      }

      // Allow if under limit
      EventBus.$emit('edit');
    },
    openUpgradeModal() {
      this.showUpgradeModal = true
      // MODAL_SHOWN tracking is handled by the watch in UpgradePrompt component
    },
    fullscreen() {
      trackEvent('fullscreen', 'click', 'viewing');
      EventBus.$emit('fullscreen');
    },
    async downloadPng() {
      trackEvent('download_png', 'click', 'viewing');
      let node = null;
      const parent = document.querySelector('.screen-capture-content');

      if (parent) {
        node = parent.querySelector('.zenuml.sequence-diagram');
      }

      if (!node) {
        node = parent;
      }
      const png = await htmlToImage.toBlob(node, {backgroundColor: 'white', skipFonts: true});
      saveAs(png, 'zenuml-for-confluence.png');
    },
    async getLikes() {
      const {atlassianAccountId: userAccountId} = await globals.apWrapper._getCurrentUser();
      const likes = await getDiagramLikes(this.diagram.id)
      this.likesCount = likes.length;
      this.userLiked = likes.some(like => like.userAccountId === userAccountId);
    },
    async clickLikeButton() {
      if (this.isLikeInFlight) return;
      trackEvent('like_diagram', 'click', 'viewing');
      console.log('clickLikeButton', store.state.diagram.id);
      const prevLiked = this.userLiked;
      const prevCount = this.likesCount;
      try {
        this.isLikeInFlight = true;
        this.userLiked = !this.userLiked;
        this.likesCount += this.userLiked ? 1 : -1;
        const likes = await toggleDiagramLike(store.state.diagram.id);
        if (!Array.isArray(likes)) {
          throw new Error('Toggle returned unexpected result');
        }
        const {atlassianAccountId: userAccountId} = await globals.apWrapper._getCurrentUser();
        this.likesCount = likes.length;
        this.userLiked = likes.some(like => like.userAccountId === userAccountId);
      } catch (error) {
        console.error('Like button error, reverting', error);
        this.userLiked = prevLiked;
        this.likesCount = prevCount;
      } finally {
        this.isLikeInFlight = false;
      }
    },
    showContentVersions() {
      trackEvent('show_content_versions', 'click', 'viewing');
      // Show quick tooltip
      this.showVersionsTooltip = true;
      // Clear any existing timer
      if (this.versionsTooltipTimer) {
        clearTimeout(this.versionsTooltipTimer);
      }
      // Auto-hide tooltip after 2 seconds
      this.versionsTooltipTimer = setTimeout(() => {
        this.showVersionsTooltip = false;
      }, 2000);

      if (this.diagram.id) {
        console.log(`Getting versions for content ID: ${this.diagram.id}`);
        globals.apWrapper.getAndPrintContentVersions(this.diagram.id)
          .then(versions => {
            console.log(`Retrieved ${versions.length} versions`);
          })
          .catch(error => {
            console.error('Error retrieving content versions:', error);
          });
      } else {
        console.warn('No content ID available to show versions');
      }
    },
    async copyCode() {
      trackEvent("copy_code", "click", this.diagramType);
      
      try {
        const code = getCodeFromDiagram(this.diagram, this.diagramType);
        
        if (!code) {
          toast({ message: 'No code to copy', duration: 2000 });
          return;
        }
        
        // Try modern Clipboard API first
        if (navigator.clipboard && window.isSecureContext) {
          try {
            await navigator.clipboard.writeText(code);
            toast({ message: 'Code copied to clipboard', duration: 2000 });
            return;
          } catch (clipboardError) {
            console.log('Clipboard API failed, using fallback:', clipboardError);
          }
        }
        
        // Fallback for iframe contexts: use textarea + execCommand
        const textarea = document.createElement('textarea');
        textarea.value = code;
        textarea.style.position = 'fixed';
        textarea.style.top = '-9999px';
        textarea.style.left = '-9999px';
        textarea.setAttribute('readonly', '');
        document.body.appendChild(textarea);
        
        textarea.select();
        textarea.setSelectionRange(0, code.length);
        
        const successful = document.execCommand('copy');
        document.body.removeChild(textarea);
        
        if (successful) {
          toast({ message: 'Code copied to clipboard', duration: 2000 });
        } else {
          throw new Error('execCommand copy failed');
        }
      } catch (error) {
        console.error('Failed to copy code:', error);
        toast({ message: 'Failed to copy code', duration: 3000 });
      }
    },
  },
}
</script>

<style scoped>
.frame {
  display: block;
}
.header {
  border-bottom: #E6E6E6 1px solid;
  background-color: #f9fafb;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
}

/* App type indicator - uses pseudo-element to avoid layout impact */
.app-indicator {
  position: relative;
}

.app-indicator::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 4px;
}

.app-indicator[data-app="full"]::before {
  background-color: #3b82f6; /* blue-500 */
}

.app-indicator[data-app="lite"]::before {
  background-color: #f97316; /* orange-500 */
}

.app-indicator[data-app="diagramly"]::before {
  background-color: #a855f7; /* purple-500 */
}
</style>
