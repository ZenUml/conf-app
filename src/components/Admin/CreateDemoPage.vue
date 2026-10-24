<template>
  <div class="create-demo-page">
    <h1>Diagramly Admin — Enroll space for demo page</h1>
    <p>
      Enrolls the chosen Confluence space. The Diagramly pipeline creates one
      demo page per enrolled space. Deleting the demo page is treated as
      opt-out — the pipeline will not recreate it.
    </p>

    <form @submit.prevent="onSubmit">
      <label for="spaceKey">Space key</label>
      <input
        id="spaceKey"
        v-model="spaceKey"
        type="text"
        placeholder="e.g. TEAM"
        required
        :disabled="busy"
      />
      <button type="submit" :disabled="busy || !spaceKey">
        {{ busy ? 'Enrolling…' : 'Enroll space' }}
      </button>
    </form>

    <div v-if="result" class="result" :class="{ ok: result.ok, err: !result.ok }">
      <p v-if="result.ok && result.alreadyExists">
        Demo page already exists for space <code>{{ spaceKey }}</code>. Page id:
        <code>{{ result.pageId }}</code>.
      </p>
      <p v-else-if="result.ok && result.pageId">
        Space enrolled and demo page created. Page id: <code>{{ result.pageId }}</code>.
      </p>
      <p v-else-if="result.ok">
        Space enrolled. The pipeline will create the demo page on its next run.
      </p>
      <p v-else-if="!result.ok && result.error === 'in_progress'">
        Another run is in progress (started {{ result.startedAt }}). Try again
        in a few minutes.
      </p>
      <p v-else>
        Enrollment failed (status {{ result.status }}, {{ result.error }}).
        <span v-if="result.detail">Detail: {{ result.detail }}</span>
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { invoke } from '@forge/bridge';

type Success = {
  ok: true;
  enrolled?: boolean;
  spaceKey?: string;
  pageId?: string;
  alreadyExists?: boolean;
  createdAt?: string;
};
type Failure = { ok: false; status: number; error: string; detail?: string; startedAt?: string };
type InvokeResult = Success | Failure;

const spaceKey = ref('');
const busy = ref(false);
const result = ref<InvokeResult | null>(null);

async function onSubmit() {
  busy.value = true;
  result.value = null;
  try {
    // Backend resolver name stays 'createDemoPage' for back-compat with any
    // already-bookmarked admin tab; the resolver now writes the enrollment
    // marker before processing.
    const res = (await invoke('createDemoPage', { spaceKey: spaceKey.value })) as InvokeResult;
    result.value = res;
  } catch (e) {
    result.value = {
      ok: false,
      status: 0,
      error: 'invoke_failed',
      detail: e instanceof Error ? e.message : String(e),
    };
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.create-demo-page { max-width: 640px; margin: 24px auto; padding: 16px; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
label { display: block; margin-top: 12px; font-weight: 600; }
input { width: 100%; padding: 8px; margin-top: 4px; box-sizing: border-box; }
button { margin-top: 12px; padding: 8px 16px; cursor: pointer; }
.result { margin-top: 16px; padding: 12px; border-radius: 4px; }
.result.ok { background: #e8f5ed; color: #0c4a2b; }
.result.err { background: #fdecea; color: #5c1916; }
code { background: #0001; padding: 0 4px; border-radius: 2px; }
</style>
