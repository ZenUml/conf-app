<template>
  <section
    v-if="visible"
    class="architecture-binding-actions"
    data-testid="architecture-token-binding-actions"
    aria-label="Architecture Token bindings"
  >
    <template v-if="directory.kind !== 'available'">
      <p data-testid="architecture-token-binding-actions-unavailable">
        Binding actions are not configured for this diagram.
      </p>
    </template>
    <template v-else-if="nodes.kind !== 'available'">
      <p data-testid="architecture-token-binding-actions-unavailable">
        Binding actions are unavailable until saved evidence matches this diagram.
      </p>
    </template>
    <template v-else>
      <p class="architecture-binding-actions__intro">
        Choose a saved Flowchart node and an approved Architecture Token. Changes are saved with the diagram.
      </p>
      <div class="architecture-binding-actions__fields">
        <label>
          Flowchart node
          <select v-model="selectedElementId" data-testid="architecture-token-node-select">
            <option value="" disabled>Select a node</option>
            <option v-for="node in nodes.entries" :key="node.diagramElementId" :value="node.diagramElementId">
              {{ node.displayName }}
            </option>
          </select>
        </label>
        <label>
          Architecture Token
          <select v-model="selectedLogicalTokenId" data-testid="architecture-token-select">
            <option value="" disabled>Select a token</option>
            <option v-for="token in directory.entries" :key="token.logicalTokenId" :value="token.logicalTokenId">
              {{ token.displayName }}
            </option>
          </select>
        </label>
        <button
          type="button"
          data-testid="architecture-token-bind"
          :disabled="!canBind || busy"
          @click="bind"
        >
          Bind token
        </button>
      </div>
      <p v-if="message" class="architecture-binding-actions__message" data-testid="architecture-token-binding-action-message">
        {{ message }}
      </p>
      <ul v-if="presentedBindings.length" class="architecture-binding-actions__bindings" aria-label="Saved Architecture Token bindings">
        <li v-for="binding in presentedBindings" :key="binding.tokenBindingId">
          <span data-testid="architecture-token-binding-summary">
            {{ binding.nodeDisplayName }} ↔ {{ binding.tokenDisplayName }}
          </span>
          <button
            type="button"
            data-testid="architecture-token-unbind"
            :disabled="busy"
            @click="unbind(binding.tokenBindingId)"
          >
            Remove binding
          </button>
        </li>
      </ul>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, inject, ref } from 'vue';
import { useStore } from 'vuex';
import {
  noBrowserLocalArchitectureTokenDirectoryProvider,
  type ArchitectureTokenDirectoryResult,
} from '@/domain/architectureTokens/architectureTokenDirectory';
import { DiagramType } from '@/model/Diagram/Diagram';
import {
  applyExplicitArchitectureTokenBind,
  applyExplicitArchitectureTokenUnbind,
} from '@/services/architectureTokens/applyExplicitArchitectureTokenBinding';
import { listBindableFlowchartNodes } from '@/services/architectureTokens/bindableFlowchartNodes';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';
import { architectureTokenDirectoryProviderKey } from './architectureTokenDirectoryProvider';

const store = useStore();
const provider = inject(
  architectureTokenDirectoryProviderKey,
  noBrowserLocalArchitectureTokenDirectoryProvider,
);
const directory = ref<ArchitectureTokenDirectoryResult>(readDirectorySnapshot());
const selectedElementId = ref('');
const selectedLogicalTokenId = ref('');
const message = ref('');
const busy = ref(false);

const visible = computed(() => store.state.diagram?.diagramType === DiagramType.Mermaid);
const readState = computed(() => store.state.diagram?.architectureTokenBindingReadState);
const nodes = computed(() => listBindableFlowchartNodes(readState.value));
const activeBindings = computed(() => readState.value?.kind === 'available'
  ? readState.value.state.bindings.filter((binding) => binding.status !== 'retired')
  : []);
const presentedBindings = computed(() => activeBindings.value.map((binding) => ({
  tokenBindingId: binding.tokenBindingId,
  nodeDisplayName: nodes.value.kind === 'available'
    ? nodes.value.entries.find((node) => node.diagramElementId === binding.diagramElementId)?.displayName
      ?? 'Saved Flowchart node'
    : 'Saved Flowchart node',
  tokenDisplayName: directory.value.kind === 'available'
    ? directory.value.entries.find((token) => token.logicalTokenId === binding.logicalTokenId)?.displayName
      ?? 'Approved Architecture Token'
    : 'Approved Architecture Token',
})));
const canBind = computed(() => directory.value.kind === 'available'
  && nodes.value.kind === 'available'
  && selectedElementId.value.length > 0
  && selectedLogicalTokenId.value.length > 0);

function readDirectorySnapshot(): ArchitectureTokenDirectoryResult {
  try {
    return provider.snapshot();
  } catch {
    return { kind: 'unavailable', reason: 'invalid_directory' };
  }
}

function analyticsProperties(result: 'bound' | 'unbound' | 'rejected', failureReason?: string) {
  return {
    feature_area: 'architecture_tokens' as const,
    surface: 'editor' as const,
    macro_type: 'mermaid' as const,
    architecture_element_kind: 'node' as const,
    architecture_algorithm_version: 'architecture-token-binding-v1',
    result,
    ...(failureReason ? { failure_reason: failureReason } : {}),
  };
}

async function bind() {
  if (!canBind.value || !store.state.diagram) return;
  busy.value = true;
  message.value = '';
  trackAnalyticsEvent('architecture_token_bind_requested', analyticsProperties('bound'));
  try {
    const result = await applyExplicitArchitectureTokenBind({
      diagram: store.state.diagram,
      directory: directory.value,
      diagramElementId: selectedElementId.value,
      logicalTokenId: selectedLogicalTokenId.value,
    });
    if (result.kind !== 'updated') {
      trackAnalyticsEvent('architecture_token_bind_failed', analyticsProperties('rejected', result.reason));
      message.value = 'Binding was not applied. Saved evidence was left unchanged.';
      return;
    }
    trackAnalyticsEvent('architecture_token_bind_succeeded', analyticsProperties('bound'));
    message.value = 'Binding added. Save the diagram to persist it.';
    selectedLogicalTokenId.value = '';
  } catch {
    trackAnalyticsEvent('architecture_token_bind_failed', analyticsProperties('rejected', 'unexpected_error'));
    message.value = 'Binding was not applied. Saved evidence was left unchanged.';
  } finally {
    busy.value = false;
  }
}

async function unbind(tokenBindingId: string) {
  if (!store.state.diagram) return;
  busy.value = true;
  message.value = '';
  trackAnalyticsEvent('architecture_token_unbind_requested', analyticsProperties('unbound'));
  try {
    const result = await applyExplicitArchitectureTokenUnbind({
      diagram: store.state.diagram,
      tokenBindingId,
    });
    if (result.kind !== 'updated') {
      trackAnalyticsEvent('architecture_token_unbind_failed', analyticsProperties('rejected', result.reason));
      message.value = 'Binding was not removed. Saved evidence was left unchanged.';
      return;
    }
    trackAnalyticsEvent('architecture_token_unbind_succeeded', analyticsProperties('unbound'));
    message.value = 'Binding removed. Save the diagram to persist it.';
  } catch {
    trackAnalyticsEvent('architecture_token_unbind_failed', analyticsProperties('rejected', 'unexpected_error'));
    message.value = 'Binding was not removed. Saved evidence was left unchanged.';
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.architecture-binding-actions {
  margin: 0 12px 8px;
  padding: 8px 10px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: #f8fafc;
  color: #334155;
  font-size: 12px;
  line-height: 1.35;
}

.architecture-binding-actions__intro,
.architecture-binding-actions__message {
  margin: 0 0 8px;
}

.architecture-binding-actions__fields,
.architecture-binding-actions__bindings li {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: 8px;
}

.architecture-binding-actions label {
  display: grid;
  gap: 3px;
  font-weight: 600;
}

.architecture-binding-actions select,
.architecture-binding-actions button {
  min-height: 28px;
  border: 1px solid #94a3b8;
  border-radius: 4px;
  background: #ffffff;
  color: inherit;
  font: inherit;
}

.architecture-binding-actions button {
  padding: 0 8px;
  cursor: pointer;
}

.architecture-binding-actions button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.architecture-binding-actions__bindings {
  display: grid;
  gap: 4px;
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
}
</style>
