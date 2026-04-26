<template>
  <table class="font-mono text-[11px] w-full border-collapse">
    <tbody>
      <tr
        v-for="key in MOCK_KEYS"
        :key="key"
        data-testid="flag-row"
        :data-key="key"
        class="border-b border-gray-200 last:border-0"
      >
        <td class="py-1 px-2 text-gray-600 whitespace-nowrap">{{ key }}</td>
        <td
          data-testid="flag-value"
          class="py-1 px-2 text-gray-900 break-all"
          :class="{ 'opacity-50': read(key) === null }"
        >{{ read(key) ?? '—' }}</td>
      </tr>
    </tbody>
  </table>
</template>

<script setup lang="ts">
import { MOCK_KEYS, type MockKey } from './presets'

function read(key: MockKey): string | null {
  return localStorage.getItem(key)
}
</script>
