<template>
  <header class="toolbar header border-b border-gray-800 p-2 flex items-center justify-between w-full">
    <OpenApiTitleInput
      :title="title"
      :spec="spec"
      :parse-error="parseError"
      :on-title-change="changeTitle"
    />
    <div class="flex items-center">
      <button
        v-if="aiChatVisible"
        type="button"
        :class="[
          'mx-1 flex items-center gap-1.5 rounded px-2 py-1 text-sm font-semibold transition-colors',
          aiChatOpen
            ? 'bg-violet-100 text-violet-800'
            : 'bg-gray-100 text-gray-600 hover:bg-violet-50 hover:text-violet-700',
        ]"
        data-testid="react-ai-chat-toggle"
        @click="onToggleAiChat?.()"
      >
        <svg
          class="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="m12 3-1.2 3.2L7.5 7.5l3.3 1.3L12 12l1.2-3.2 3.3-1.3-3.3-1.3L12 3Z" />
          <path d="m5 14-.8 2.2L2 17l2.2.8L5 20l.8-2.2L8 17l-2.2-.8L5 14Z" />
        </svg>
        <span>AI Chat</span>
      </button>
      <button
        type="button"
        class="help mx-1 ml-2 flex items-center bg-gray-100 px-2 py-1 text-gray-600 text-sm font-semibold rounded hover:bg-gray-200 cursor-pointer"
        @click="helpClick"
      >
        <span>
          <svg
            class="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </span>
        <span>Help</span>
      </button>
      <div class="openapi-publish-slot inline-block ml-4">
        <PublishButton :save-and-exit="handleSaveAndExit" :disabled="!title" :loading="isSaving" />
      </div>
    </div>
  </header>
</template>

<style scoped>
/* Override the legacy .save-and-exit { position: fixed; right: 10px } rule in
   swagger-editor.css so PublishButton.vue sits inline in the header flex row. */
.openapi-publish-slot :deep(.save-and-exit) {
  position: static;
  right: auto;
  z-index: auto;
}
</style>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import yaml from 'js-yaml'
import { trackEvent } from '@/utils/window'
import PublishButton from '@/components/PublishButton.vue'
import OpenApiTitleInput from '@/components/OpenApi/OpenApiTitleInput.vue'
import { setupCloseGuard } from '@/utils/closeGuard'
import {
  makeDebouncedDraftSaver,
  loadDraft,
  clearDraft,
  primeCloudId,
  getCachedCloudId,
  getCachedSavedVersionUpdatedAt,
  saveDraftSync,
  isDraftNewerThanSaved,
} from '@/utils/draftStore'
import EventBus from '@/EventBus'
import { openUrl } from '@/model/globals/forgeGlobal'
import { getOpenApiTitleField } from '@/model/OpenApi/OpenApiEditorState'
import store from '@/model/store2'
import { isAiChatEnabled } from '@/apis/aiTitleFeatureFlag'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'

const HELP_URL =
  'https://zenuml.com/docs?utm_source=confluence-plugin&utm_medium=help-button&utm_campaign=confluence-plugin'

const props = withDefaults(
  defineProps<{
    saveAndExit: () => void
    exit: () => void
    aiChatOpen?: boolean
    onToggleAiChat?: () => void
  }>(),
  {
    aiChatOpen: false,
    onToggleAiChat: undefined,
  },
)

const title = ref('')
const spec = ref(window.specContent ?? window.diagram?.code ?? '')
const parseError = ref<Error | null>(null)
const isSaving = ref(false)
const aiChatEnabled = ref(false)

let originalSpec: string | null = null
let savingTimeout: ReturnType<typeof setTimeout> | null = null
let aiChatWasVisible = false
let cleanupDraftAndListeners: (() => void) | null = null
let handleEditorChangeListener: ((nextSpec: string) => void) | null = null

const aiChatVisible = computed(() => aiChatEnabled.value && !!props.onToggleAiChat)

watch(
  aiChatVisible,
  (visible) => {
    if (visible && !aiChatWasVisible) {
      trackAnalyticsEvent('ai_chat_button_shown', {
        feature_area: 'ai',
        surface: 'editor',
        macro_type: 'openapi',
      })
    }
    aiChatWasVisible = visible
  },
  { immediate: true },
)

function handleSaveAndExit() {
  if (isSaving.value) return
  isSaving.value = true
  if (savingTimeout) clearTimeout(savingTimeout)
  savingTimeout = setTimeout(() => {
    isSaving.value = false
  }, 20000)
  props.saveAndExit()
}

function helpClick() {
  trackEvent('help', 'click', 'open-api')
  void openUrl(HELP_URL)
}

function updateStoreTitle(value: string) {
  if (typeof (store as any).commit === 'function') {
    store.commit('updateTitle', value)
  } else if (typeof (store as any).dispatch === 'function') {
    void store.dispatch('updateTitle', value)
  }
}

function setTitleWithSideEffect(value: string) {
  title.value = value
  updateStoreTitle(value)
  if (window.diagram) {
    window.diagram.title = value
  }
}

function changeTitle(value: string) {
  setTitleWithSideEffect(value)
  if (window.diagram) {
    try {
      yaml.loadAll(window.specContent || spec.value || '', function (data) {
        if (!data) return
        const doc: Record<string, any> = data as any
        if (doc && doc.info) {
          doc.info.title = value
          window.editor.specActions.updateSpec(yaml.dump(doc))
        }
      })
      parseError.value = null
    } catch (error) {
      console.error('Error parsing YAML:', error)
      parseError.value = error instanceof Error ? error : new Error(String(error))
    }
  }
}

onMounted(() => {
  let cancelled = false

  isAiChatEnabled().then((enabled) => {
    if (!cancelled) aiChatEnabled.value = enabled
  })

  // Draft lifecycle + close guard
  const captureBaseline = (nextSpec: string) => {
    if (originalSpec === null && nextSpec) {
      originalSpec = nextSpec
    }
  }
  captureBaseline(window.specContent ?? window.diagram?.code ?? '')

  if (!window.specListeners) window.specListeners = []
  window.specListeners.push(captureBaseline)

  const diagramId = (window as any).diagram?.id
  const scope = diagramId ? `edit:${diagramId}` : 'new:openapi'
  const saver = makeDebouncedDraftSaver(scope, 500)
  let saveOnChange: ((nextSpec: string) => void) | null = null
  let closeGuardOff: (() => void) | null = null
  let onSaved: ((id: string) => void) | null = null
  let onSaveError: (() => void) | null = null
  let onRestore: ((payload: any) => void) | null = null

  const resetSaving = () => {
    isSaving.value = false
    if (savingTimeout) {
      clearTimeout(savingTimeout)
      savingTimeout = null
    }
  }

  void (async () => {
    await primeCloudId()
    if (cancelled) return

    const draft = await loadDraft(scope)
    if (draft) {
      const baseline = originalSpec ?? ''
      const savedVersionUpdatedAt =
        getCachedSavedVersionUpdatedAt() ?? (window as any).diagram?.updatedAt
      if (isDraftNewerThanSaved(draft, savedVersionUpdatedAt) && draft.code !== baseline) {
        EventBus.$emit('draft-available', { scope, draft })
      } else {
        await clearDraft(scope)
      }
    }

    saveOnChange = (nextSpec: string) => {
      if (originalSpec === null || nextSpec === originalSpec) return
      saver.save({ code: nextSpec, title: (window as any).diagram?.title || '' })
    }
    window.specListeners!.push(saveOnChange)

    closeGuardOff = setupCloseGuard(() => {
      const current = window.specContent ?? window.diagram?.code ?? ''
      if (originalSpec === null || current === originalSpec) return
      const cloudId = getCachedCloudId()
      if (cloudId) {
        saveDraftSync(scope, cloudId, {
          code: current,
          title: (window as any).diagram?.title || '',
        })
      }
    })

    onSaved = () => {
      resetSaving()
      saver.cancel()
      clearDraft(scope)
    }
    EventBus.$on('saved', onSaved)

    onSaveError = () => resetSaving()
    EventBus.$on('save-error', onSaveError)

    onRestore = (payload: any) => {
      if (payload?.scope !== scope || !payload?.draft) return
      try {
        ;(window as any).editor?.specActions?.updateSpec(payload.draft.code)
        if (payload.draft.title && (window as any).diagram) {
          ;(window as any).diagram.title = payload.draft.title
        }
        originalSpec = ''
        clearDraft(scope)
      } catch (e) {
        console.error('[draft-restore] openapi restore failed', e)
      }
    }
    EventBus.$on('draft-restore', onRestore)
  })()

  // Initial YAML title sync + specListeners subscription
  if (window.diagram) {
    try {
      spec.value = window.diagram.code || ''
      yaml.loadAll(window.diagram.code || '', function (data) {
        if (!data) return
        const doc: Record<string, any> = data as any
        const nextTitle = getOpenApiTitleField(doc)
        if (nextTitle !== undefined) setTitleWithSideEffect(nextTitle)
      })
      parseError.value = null
    } catch (error) {
      console.error('Error parsing YAML in onMounted:', error)
      parseError.value = error instanceof Error ? error : new Error(String(error))
    }
  }

  handleEditorChangeListener = (nextSpec: string) => {
    spec.value = nextSpec
    try {
      yaml.loadAll(nextSpec, function (data) {
        if (!data) return
        const doc: Record<string, any> = data as any
        const nextTitle = getOpenApiTitleField(doc)
        if (nextTitle !== undefined) {
          setTitleWithSideEffect(nextTitle)
        }
      })
      parseError.value = null
    } catch (error) {
      console.error('Error parsing YAML in editor change:', error)
      parseError.value = error instanceof Error ? error : new Error(String(error))
    }
  }
  window.specListeners.push(handleEditorChangeListener)

  cleanupDraftAndListeners = () => {
    cancelled = true
    if (window.specListeners) {
      window.specListeners = window.specListeners.filter(
        (l: any) =>
          l !== captureBaseline && l !== saveOnChange && l !== handleEditorChangeListener,
      )
    }
    saver.flush()
    closeGuardOff?.()
    if (savingTimeout) clearTimeout(savingTimeout)
    if (onSaved) EventBus.$off('saved', onSaved)
    if (onSaveError) EventBus.$off('save-error', onSaveError)
    if (onRestore) EventBus.$off('draft-restore', onRestore)
  }
})

onBeforeUnmount(() => {
  cleanupDraftAndListeners?.()
})
</script>
