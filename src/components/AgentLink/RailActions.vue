<template>
  <!-- Rail footer actions (design contract §Region→component: RailActions).
       Disconnect (ghost-danger) is the macro-side explicit close → closed;
       Revoke & re-link (quiet text link) closes + mints a fresh token. Keeps
       the data-testid hooks the existing ConnectPanel spec asserts. -->
  <div class="agent-rail-actions">
    <button
      type="button"
      class="agent-rail-actions__btn agent-rail-actions__btn--danger"
      data-testid="agent-link-disconnect-btn"
      @click="emit('disconnect')"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" d="m3 3 8.735 8.735m0 0a.374.374 0 1 1 .53.53m-.53-.53.53.53m0 0L21 21M14.652 9.348a3.75 3.75 0 0 1 0 5.304m2.121-7.425a6.75 6.75 0 0 1 0 9.546m2.121-11.667c3.808 3.807 3.808 9.98 0 13.788m-9.546-4.242a3.733 3.733 0 0 1-1.06-2.122m-1.061 4.243a6.75 6.75 0 0 1-1.625-6.929m-.496 9.05c-3.068-3.067-3.664-7.67-1.79-11.334M12 12h.008v.008H12V12Z" />
      </svg>
      Disconnect
    </button>
    <span class="agent-rail-actions__spacer"></span>
    <button
      type="button"
      class="agent-rail-actions__link"
      data-testid="agent-link-revoke-btn"
      @click="emit('revoke')"
    >Revoke &amp; re-link</button>
  </div>
</template>

<script setup lang="ts">
const emit = defineEmits<{
  (e: 'disconnect'): void
  (e: 'revoke'): void
}>()
</script>

<style scoped>
.agent-rail-actions {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
  border-top: 1px solid #e5e7eb;
  padding: 12px 16px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
.agent-rail-actions__spacer {
  flex: 1 1 auto;
}
.agent-rail-actions__btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 14px;
  border-radius: 6px;
  border: 1px solid #e5e7eb;
  background: transparent;
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 200ms ease, border-color 200ms ease;
}
.agent-rail-actions__btn svg {
  width: 15px;
  height: 15px;
}
.agent-rail-actions__btn--danger {
  color: #a32717;
}
.agent-rail-actions__btn--danger:hover {
  background: #fcece9;
  border-color: #f0cfc8;
}
.agent-rail-actions__link {
  background: none;
  border: none;
  color: #6b778c;
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
  padding: 0;
  transition: color 200ms ease;
}
.agent-rail-actions__link:hover {
  color: #172b4d;
  text-decoration: underline;
}
@media (prefers-color-scheme: dark) {
  .agent-rail-actions {
    border-top-color: #3a3f4b;
  }
  .agent-rail-actions__btn {
    border-color: #3a3f4b;
  }
  .agent-rail-actions__btn--danger {
    color: #f0a88c;
  }
  .agent-rail-actions__link {
    color: #9aa3b2;
  }
  .agent-rail-actions__link:hover {
    color: #e6e8ee;
  }
}
</style>
