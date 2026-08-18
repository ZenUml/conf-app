<template>
  <div class="get-started-page">
    <div class="hero-section">
      <div class="hero-content">
        <h1>Welcome to ZenUML Diagrams!</h1>
        <p class="hero-description">
          Create the first example page below, or go to any Confluence page and use the "+" button to insert a ZenUML macro.
        </p>
      </div>
    </div>

    <div class="action-section">
      <h2>Create an examples page</h2>
      <p class="action-lead">
        Pick a space and we'll add one page there with a Sequence, Mermaid, Graph and OpenAPI diagram already
        working — a starting point your team can copy from.
      </p>

      <form class="action-form" @submit.prevent="createExamplesPage">
        <label for="get-started-space-key">Space key</label>
        <input
          id="get-started-space-key"
          v-model="spaceKey"
          type="text"
          placeholder="e.g. TEAM"
          :disabled="busy"
          required
        />
        <button type="submit" class="btn btn-primary" :disabled="busy || !spaceKey.trim()">
          {{ busy ? 'Creating…' : 'Create examples page' }}
        </button>
      </form>

      <div v-if="result" class="action-result" :class="{ ok: result.ok, err: !result.ok }" role="status">
        <p v-if="result.ok && result.pageId">
          <span v-if="result.alreadyExists">An examples page already exists for <code>{{ spaceKey }}</code>.</span>
          <span v-else>Examples page created in <code>{{ spaceKey }}</code>.</span>
          <a
            v-if="resultPageUrl"
            :href="resultPageUrl"
            target="_blank"
            rel="noopener"
            class="resource-link"
            @click.prevent="openResultPage"
          >Open the page →</a>
        </p>
        <p v-else-if="result.ok">
          Space enrolled. The examples page will be created shortly.
        </p>
        <p v-else-if="!result.ok && result.error === 'in_progress'">
          Another run is already in progress for this space. Try again in a few minutes.
        </p>
        <template v-else>
          <p>{{ errorMessage }}</p>
          <p v-if="result.orphanDraftPageId">
            A draft page (id <code>{{ result.orphanDraftPageId }}</code>) was left behind and was not published.
            It is not visible to other users; an admin can delete it from Confluence if desired.
          </p>
        </template>
      </div>

      <div v-else-if="timedOut" class="action-result err" role="status">
        <p>
          The request has not returned after {{ TIMEOUT_SECONDS_LABEL }} seconds. The server-side run may still
          complete in the background.
        </p>
        <p>
          Reload this page and check <code>{{ spaceKey }}</code> for an examples page before trying again, so a
          second attempt does not create a duplicate.
        </p>
      </div>
    </div>

    <div class="resources-section">
      <h2>Resources & Support</h2>
      <div class="resources-grid">
        <div class="resource-card">
          <h4>📚 Documentation</h4>
          <p>Guides and language reference</p>
          <a
            :href="DOCS_URL"
            target="_blank"
            rel="noopener"
            class="resource-link"
            @click.prevent="onResourceClick(DOCS_URL, 'view_documentation')"
          >
            View Documentation →
          </a>
        </div>
        <div class="resource-card">
          <h4>🎥 Video Tutorials</h4>
          <p>Step-by-step video guides</p>
          <a
            :href="VIDEO_URL"
            target="_blank"
            rel="noopener"
            class="resource-link"
            @click.prevent="onResourceClick(VIDEO_URL, 'watch_videos')"
          >
            Watch Videos →
          </a>
        </div>
        <div class="resource-card">
          <h4>💬 Community</h4>
          <p>Get help from the community</p>
          <a
            :href="COMMUNITY_URL"
            target="_blank"
            rel="noopener"
            class="resource-link"
            @click.prevent="onResourceClick(COMMUNITY_URL, 'join_community')"
          >
            Join Community →
          </a>
        </div>
        <div class="resource-card">
          <h4>🐛 Report Issues</h4>
          <p>Found a bug? Let us know</p>
          <a
            :href="ISSUE_URL"
            target="_blank"
            rel="noopener"
            class="resource-link"
            @click.prevent="onResourceClick(ISSUE_URL, 'report_issue')"
          >
            Report Issue →
          </a>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { invoke } from "@forge/bridge";
import { trackAnalyticsEvent } from "@/utils/analytics/trackAnalyticsEvent";
import { openUrl } from "@/model/globals/forgeGlobal";
import { getBaseUrl } from "@/utils/ContextParameters/ContextParameters";

const DOCS_URL = "https://zenuml.atlassian.net/wiki/spaces/Doc/overview";
const VIDEO_URL = "https://www.youtube.com/watch?v=cqQLyOwAZ0A";
const COMMUNITY_URL = "https://community.atlassian.com";
const ISSUE_URL = "https://zenuml.atlassian.net/servicedesk";

const ANALYTICS_BASE = { feature_area: "confluence", surface: "dashboard" };

// The resolver's pipeline (src/createDemoPage.js) runs sequentially: create a
// draft page, create one custom content object per diagram type (Sequence,
// Mermaid, Graph, OpenAPI — 4 REST calls), then publish the page. That is 6
// sequential Confluence REST round-trips; each has run well under 2s in
// staging, so 20s leaves a wide margin over the observed happy path before
// telling the admin something is wrong, while still being short enough that
// a genuinely stuck request does not read as a frozen page.
const INVOKE_TIMEOUT_MS = 20000;

export default {
  name: "GetStarted",
  data() {
    return {
      DOCS_URL,
      VIDEO_URL,
      COMMUNITY_URL,
      ISSUE_URL,
      TIMEOUT_SECONDS_LABEL: String(INVOKE_TIMEOUT_MS / 1000),
      spaceKey: "",
      busy: false,
      result: null,
      timedOut: false,
      // Bumped on every submit so a late resolution from an earlier,
      // already-timed-out (or superseded) invoke can recognize it is stale
      // and refuse to overwrite whatever state the admin is looking at now.
      requestSeq: 0,
    };
  },
  computed: {
    resultPageUrl() {
      if (!this.result || !this.result.ok || !this.result.pageId) return null;
      const base = getBaseUrl();
      if (!base) return null;
      return `${base}/wiki/pages/viewpage.action?pageId=${this.result.pageId}`;
    },
    // Prefer the resolver's own `detail` (e.g. "Missing required Forge
    // environment variable(s): APP_LABEL" or "macro=graph status=400 ...")
    // over the bare error code — it is the only field that actually tells
    // an admin what went wrong. Falls back to the error code, then a
    // generic message, for resolver outcomes that carry neither.
    errorMessage() {
      if (!this.result) return '';
      const reason = this.result.detail || this.result.error || 'unknown error';
      return `Could not create the examples page: ${reason}. Try again, or insert a macro manually from the "+" button on any Confluence page.`;
    },
  },
  mounted() {
    trackAnalyticsEvent("get_started_viewed", { ...ANALYTICS_BASE });
  },
  methods: {
    async createExamplesPage() {
      const spaceKey = this.spaceKey.trim();
      if (!spaceKey || this.busy) return;

      trackAnalyticsEvent("get_started_action_clicked", {
        ...ANALYTICS_BASE,
        action: "create_examples_page",
      });

      this.busy = true;
      this.result = null;
      this.timedOut = false;

      const requestSeq = ++this.requestSeq;
      let timedOutHere = false;
      const timeoutId = setTimeout(() => {
        // A newer submit already superseded this one; let its own timer own
        // the UI state.
        if (requestSeq !== this.requestSeq) return;
        timedOutHere = true;
        this.busy = false;
        this.timedOut = true;
        this.result = null;
      }, INVOKE_TIMEOUT_MS);

      try {
        // Reuses the same resolver/pipeline the Diagramly admin panel uses
        // (src/createDemoPage.js) — do not write a second one.
        const res = await invoke("createDemoPage", { spaceKey });
        clearTimeout(timeoutId);
        // Stale if a newer submit has since started, or if the deadline for
        // THIS request already fired and put up the "not returned" warning —
        // a late success/failure must not silently clobber that warning
        // (the admin may already have reloaded and acted on it).
        if (requestSeq !== this.requestSeq || timedOutHere) return;
        this.result = res;
        this.busy = false;
      } catch (e) {
        clearTimeout(timeoutId);
        if (requestSeq !== this.requestSeq || timedOutHere) return;
        this.result = {
          ok: false,
          error: "invoke_failed",
          detail: e instanceof Error ? e.message : String(e),
        };
        this.busy = false;
      }
    },

    async openResultPage() {
      if (this.resultPageUrl) {
        await openUrl(this.resultPageUrl);
      }
    },

    async onResourceClick(url, action) {
      trackAnalyticsEvent("get_started_action_clicked", { ...ANALYTICS_BASE, action });
      await openUrl(url);
    },
  },
};
</script>

<style scoped>
.get-started-page {
  max-width: 760px;
  margin: 0 auto;
  padding: 24px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: #172B4D;
}

.hero-section {
  text-align: center;
  padding: 40px 24px;
  background: linear-gradient(135deg, #0052CC 0%, #0747A6 100%);
  color: white;
  border-radius: 8px;
  margin-bottom: 32px;
}

.hero-content h1 {
  font-size: 30px;
  font-weight: 700;
  margin: 0 0 12px 0;
}

.hero-description {
  font-size: 16px;
  margin: 0;
  opacity: 0.9;
  max-width: 560px;
  margin-left: auto;
  margin-right: auto;
}

.action-section {
  background: white;
  border: 1px solid #DFE1E6;
  border-radius: 8px;
  padding: 24px;
  margin-bottom: 32px;
}

.action-section h2 {
  margin: 0 0 8px 0;
  font-size: 22px;
  font-weight: 600;
}

.action-lead {
  margin: 0 0 20px 0;
  color: #6B778C;
  line-height: 1.5;
}

.action-form {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  flex-wrap: wrap;
}

.action-form label {
  display: block;
  font-weight: 600;
  font-size: 13px;
  margin-bottom: 4px;
}

.action-form input {
  padding: 8px 10px;
  border: 1px solid #DFE1E6;
  border-radius: 4px;
  font-size: 14px;
  min-width: 200px;
}

.btn {
  padding: 10px 20px;
  border: none;
  border-radius: 4px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s;
}

.btn-primary {
  background: #0052CC;
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: #0747A6;
}

.btn-primary:disabled {
  background: #A5ADBA;
  cursor: not-allowed;
}

.action-result {
  margin-top: 16px;
  padding: 12px 14px;
  border-radius: 4px;
  font-size: 14px;
}

.action-result.ok {
  background: #e8f5ed;
  color: #0c4a2b;
}

.action-result.err {
  background: #fdecea;
  color: #5c1916;
}

.action-result code {
  background: rgba(0, 0, 0, 0.06);
  padding: 0 4px;
  border-radius: 2px;
}

.action-result .resource-link {
  margin-left: 8px;
}

.resources-section {
  margin-bottom: 8px;
}

.resources-section h2 {
  text-align: center;
  font-size: 22px;
  font-weight: 600;
  margin: 0 0 24px 0;
}

.resources-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 20px;
}

.resource-card {
  background: white;
  border: 1px solid #DFE1E6;
  border-radius: 8px;
  padding: 20px;
  transition: transform 0.2s, box-shadow 0.2s;
}

.resource-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.resource-card h4 {
  margin: 0 0 8px 0;
  font-size: 16px;
  font-weight: 600;
}

.resource-card p {
  margin: 0 0 12px 0;
  color: #6B778C;
  line-height: 1.5;
  font-size: 14px;
}

.resource-link {
  color: #0052CC;
  text-decoration: none;
  font-weight: 500;
  transition: color 0.2s;
}

.resource-link:hover {
  color: #0747A6;
  text-decoration: underline;
}

@media (max-width: 768px) {
  .hero-content h1 {
    font-size: 24px;
  }

  .hero-description {
    font-size: 15px;
  }

  .action-form {
    flex-direction: column;
    align-items: stretch;
  }

  .resources-grid {
    grid-template-columns: 1fr;
  }
}
</style>
