<template>
  <BasePromptModal :visible="visible" width-class="w-[480px]" @close="$emit('close')">
    <template #title>Editing paused on this space</template>

    <p class="text-sm text-gray-700 mb-4">
      This space has reached the ZenUML Lite limit (100 macros).
      Existing diagrams still render — but new edits are paused until the space is upgraded.
    </p>

    <div class="space-y-2 mb-4">
      <button
        data-testid="notify-admin-btn"
        :disabled="notifying || notified"
        class="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-2 px-3 rounded text-sm cursor-pointer"
        @click="onNotify"
      >
        {{ notified ? 'Admin notified ✓' : (notifying ? 'Notifying…' : 'Notify the space admin →') }}
      </button>
    </div>

    <p class="text-xs text-gray-600 mb-2">
      Or, if you own this space:
      <button
        data-testid="self-identify-owner"
        class="text-blue-600 hover:underline cursor-pointer"
        @click="onOwner"
      >See upgrade options</button>
    </p>

    <template #footer>
      <div class="flex justify-between items-center">
        <button
          data-testid="continue-editing-btn"
          class="text-sm text-gray-600 hover:text-gray-800 hover:underline cursor-pointer"
          @click="onContinueEditing"
        >Continue editing without upgrading</button>
        <button
          data-testid="dismiss-btn"
          class="text-sm text-gray-600 hover:text-gray-800 cursor-pointer"
          @click="$emit('close')"
        >Got it</button>
      </div>
    </template>
  </BasePromptModal>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import BasePromptModal from './BasePromptModal.vue'
import { notifyAdmin } from '@/utils/notifyAdmin'
import { trackUpgradeEvent, UpgradeEventName, Persona } from '@/utils/upgradeTracking'

const props = defineProps<{
  visible: boolean
  spaceKey: string
  requesterDisplayName?: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'continueEditing'): void
  (e: 'showHeavyCreator'): void
}>()

function onContinueEditing() {
  trackUpgradeEvent(UpgradeEventName.PAYWALL_CONTINUED_EDITING, {
    persona: Persona.BYSTANDER,
    prompt_variant: 'bystander_notice',
  })
  emit('continueEditing')
}

const notifying = ref(false)
const notified = ref(false)

watch(() => props.visible, (v) => {
  if (v) {
    trackUpgradeEvent(UpgradeEventName.BYSTANDER_NOTICE_SHOWN, { persona: Persona.BYSTANDER })
  }
}, { immediate: true })

async function onNotify() {
  if (notifying.value || notified.value) return
  notifying.value = true
  try {
    const result = await notifyAdmin({ spaceKey: props.spaceKey, requesterDisplayName: props.requesterDisplayName })
    notified.value = !!result.notified
    trackUpgradeEvent(UpgradeEventName.BYSTANDER_ADMIN_NOTIFIED, {
      persona: Persona.BYSTANDER,
      admin_count: result.adminCount ?? 0,
      reason: result.reason,
    })
  } finally {
    notifying.value = false
  }
}

function onOwner() {
  trackUpgradeEvent(UpgradeEventName.BYSTANDER_OWNER_SELF_IDENTIFY, { persona: Persona.BYSTANDER })
  emit('showHeavyCreator')
}
</script>
