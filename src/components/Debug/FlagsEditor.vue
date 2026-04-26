<template>
  <div class="font-mono text-[11px] p-2">
    <table class="w-full border-collapse">
      <tbody>
        <tr v-for="row in rows" :key="row.key" class="border-b border-gray-200 last:border-0">
          <td class="py-1 px-2 text-gray-600 align-top">{{ row.key }}</td>
          <td class="py-1 px-2">
            <select
              v-if="row.kind === 'bool'"
              :data-testid="`edit-${row.key}`"
              :value="form[row.key] ?? 'unset'"
              @change="onChange(row.key, ($event.target as HTMLSelectElement).value)"
              class="border border-gray-300 rounded px-1 py-0.5 bg-white"
            >
              <option value="unset">unset</option>
              <option value="true">true</option>
              <option value="false">false</option>
            </select>

            <span v-else-if="row.kind === 'number'" class="inline-flex items-center gap-2">
              <input
                :data-testid="`edit-${row.key}`"
                type="number"
                :value="form[row.key] ?? ''"
                @input="onChange(row.key, ($event.target as HTMLInputElement).value)"
                class="border border-gray-300 rounded px-1 py-0.5 w-20"
              />
              <label class="inline-flex items-center gap-1">
                <input
                  type="checkbox"
                  :checked="form[row.key] === undefined"
                  @change="toggleUnset(row.key, ($event.target as HTMLInputElement).checked)"
                />
                unset
              </label>
            </span>

            <select
              v-else-if="row.kind === 'enum'"
              :data-testid="`edit-${row.key}`"
              :value="form[row.key] ?? 'unset'"
              @change="onChange(row.key, ($event.target as HTMLSelectElement).value)"
              class="border border-gray-300 rounded px-1 py-0.5 bg-white"
            >
              <option value="unset">unset</option>
              <option value="unknown">unknown</option>
              <option value="small_likely">small_likely</option>
              <option value="medium_or_larger">medium_or_larger</option>
            </select>

            <span v-else-if="row.kind === 'json'" class="block">
              <textarea
                :data-testid="`edit-${row.key}`"
                :value="form[row.key] ?? ''"
                @input="onChange(row.key, ($event.target as HTMLTextAreaElement).value)"
                rows="2"
                class="border border-gray-300 rounded px-1 py-0.5 w-full font-mono text-[11px]"
              />
              <span
                v-if="jsonErrors[row.key]"
                :data-testid="`editor-error-${row.key}`"
                class="text-red-600 text-[10px]"
              >Invalid JSON</span>
            </span>
          </td>
        </tr>
      </tbody>
    </table>

    <div class="flex gap-2 mt-2 px-2">
      <button
        data-testid="editor-save"
        :disabled="!canSave"
        class="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer border-none font-mono text-[11px]"
        @click="onSave"
      >Save</button>
      <button
        data-testid="editor-cancel"
        class="px-3 py-1 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 cursor-pointer border-none font-mono text-[11px]"
        @click="$emit('cancel')"
      >Cancel</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, computed } from 'vue'
import { MOCK_KEYS, type MockKey } from './presets'

defineEmits<{ (e: 'cancel'): void }>()

type Kind = 'bool' | 'number' | 'enum' | 'json'
const KIND: Record<MockKey, Kind> = {
  mockCSSEnabled: 'bool',
  mockMacroCount: 'number',
  mockSpacePaid: 'bool',
  mockPersonaAwarePaywall: 'bool',
  mockPersonalAuthored: 'number',
  mockTenantSizeEstimate: 'enum',
  mockConfluenceAdmin: 'bool',
  mockPersonaThreshold: 'number',
  mockNotifyAdmin: 'json',
}

const rows = MOCK_KEYS.map((k) => ({ key: k, kind: KIND[k] }))

const form = reactive<Partial<Record<MockKey, string>>>({})
for (const k of MOCK_KEYS) {
  const v = localStorage.getItem(k)
  if (v !== null) form[k] = v
}

function onChange(key: MockKey, val: string) {
  if (val === 'unset') delete form[key]
  else form[key] = val
}

function toggleUnset(key: MockKey, checked: boolean) {
  if (checked) delete form[key]
  else form[key] = '0'
}

const jsonErrors = computed<Record<string, boolean>>(() => {
  const errors: Record<string, boolean> = {}
  for (const k of MOCK_KEYS) {
    if (KIND[k] === 'json' && form[k] !== undefined) {
      try { JSON.parse(form[k] as string) } catch { errors[k] = true }
    }
  }
  return errors
})

const canSave = computed(() => Object.keys(jsonErrors.value).length === 0)

function onSave() {
  if (!canSave.value) return
  for (const k of MOCK_KEYS) {
    if (form[k] === undefined) localStorage.removeItem(k)
    else localStorage.setItem(k, form[k] as string)
  }
  window.location.reload()
}
</script>
