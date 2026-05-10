<template>
  <div v-if="visible" class="restore-banner" role="status">
    <span class="restore-banner-icon" aria-hidden="true">⟲</span>
    <span class="restore-banner-text">
      Unsaved changes from {{ relativeTime }} — these were preserved when the modal closed.
    </span>
    <button type="button" class="restore-banner-btn primary" @click="onRestore">Restore</button>
    <button type="button" class="restore-banner-btn" @click="onDiscard">Discard</button>
    <button type="button" class="restore-banner-close" @click="onDismiss" aria-label="Dismiss">✕</button>
  </div>
</template>

<script>
import EventBus from "@/EventBus";
import { clearDraft } from "@/utils/draftStore";

export default {
  name: "RestoreDraftBanner",
  data() {
    return {
      visible: false,
      scope: null,
      draft: null,
    };
  },
  computed: {
    relativeTime() {
      if (!this.draft?.savedAt) return "";
      const diffMs = Date.now() - this.draft.savedAt;
      const min = Math.floor(diffMs / 60000);
      if (min < 1) return "just now";
      if (min < 60) return `${min} min${min === 1 ? "" : "s"} ago`;
      const hr = Math.floor(min / 60);
      if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
      const day = Math.floor(hr / 24);
      return `${day} day${day === 1 ? "" : "s"} ago`;
    },
  },
  mounted() {
    this._onAvailable = (payload) => {
      this.scope = payload?.scope || null;
      this.draft = payload?.draft || null;
      this.visible = true;
    };
    EventBus.$on("draft-available", this._onAvailable);
  },
  beforeUnmount() {
    if (this._onAvailable) EventBus.$off("draft-available", this._onAvailable);
  },
  methods: {
    onRestore() {
      EventBus.$emit("draft-restore", { scope: this.scope, draft: this.draft });
      this.visible = false;
    },
    async onDiscard() {
      if (this.scope) await clearDraft(this.scope);
      this.visible = false;
    },
    onDismiss() {
      // Just hide the banner; leave the draft in storage.
      this.visible = false;
    },
  },
};
</script>

<style scoped>
.restore-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  background: #fff8c5;
  border-bottom: 1px solid #d4a72c;
  color: #57460a;
  font-size: 13px;
}
.restore-banner-icon { font-size: 16px; }
.restore-banner-text { flex: 1; min-width: 0; }
.restore-banner-btn {
  background: #fff;
  border: 1px solid #d4a72c;
  color: #57460a;
  padding: 4px 12px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
}
.restore-banner-btn:hover { background: #fef9d7; }
.restore-banner-btn.primary {
  background: #57460a;
  color: #fff8c5;
  border-color: #57460a;
}
.restore-banner-btn.primary:hover { background: #3d3008; }
.restore-banner-close {
  background: none;
  border: none;
  color: #57460a;
  cursor: pointer;
  font-size: 14px;
  padding: 4px 8px;
}
.restore-banner-close:hover { color: #2a2206; }
</style>
