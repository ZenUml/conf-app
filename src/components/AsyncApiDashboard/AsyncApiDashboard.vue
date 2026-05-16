<!--
  AsyncAPI variant landing page. Shown when the user clicks the
  "AsyncAPI for Confluence" entry in the Confluence space sidebar
  ("Your apps" section).

  Scope (PR #1): scaffolding only — a welcoming static page with quick
  instructions. Future PRs can add a list of AsyncAPI macros across the
  space, recent edits, version history, etc.
-->
<template>
  <div class="asyncapi-dashboard">
    <header class="asyncapi-dashboard__header">
      <h1>AsyncAPI for Confluence</h1>
      <p class="asyncapi-dashboard__tagline">
        Document, visualize, and share your event-driven APIs alongside the rest of your Confluence content.
      </p>
    </header>

    <section class="asyncapi-dashboard__section">
      <h2>Getting started</h2>
      <ol>
        <li>Open or create a Confluence page.</li>
        <li>
          Type <code>/AsyncAPI</code> and pick <strong>AsyncAPI Spec</strong> from the
          macro list.
        </li>
        <li>
          Edit your spec inline in the embedded
          <a
            href="https://studio.asyncapi.com/"
            target="_blank"
            rel="noopener noreferrer"
          >AsyncAPI Studio</a>.
        </li>
        <li>Save — the rendered spec replaces the macro on the page.</li>
      </ol>
    </section>

    <section class="asyncapi-dashboard__section">
      <h2>About</h2>
      <p>
        AsyncAPI for Confluence renders specs using
        <a
          href="https://github.com/asyncapi/asyncapi-react"
          target="_blank"
          rel="noopener noreferrer"
        ><code>@asyncapi/react-component</code></a>
        and edits them with the embedded
        <a
          href="https://github.com/asyncapi/studio"
          target="_blank"
          rel="noopener noreferrer"
        >AsyncAPI Studio</a>.
        Specs are stored as Confluence custom content scoped to the space.
      </p>
    </section>
  </div>
</template>

<script setup lang="ts">
// Static dashboard for now — no data fetching yet.
</script>

<style scoped>
.asyncapi-dashboard {
  max-width: 720px;
  margin: 0 auto;
  padding: 24px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: #172b4d;
  line-height: 1.5;
}

.asyncapi-dashboard__header {
  border-bottom: 1px solid #dfe1e6;
  padding-bottom: 16px;
  margin-bottom: 24px;
}

.asyncapi-dashboard__header h1 {
  margin: 0;
  font-size: 24px;
  color: #0052cc;
}

.asyncapi-dashboard__tagline {
  margin: 8px 0 0;
  color: #5e6c84;
  font-size: 14px;
}

.asyncapi-dashboard__section {
  margin-bottom: 24px;
}

.asyncapi-dashboard__section h2 {
  margin: 0 0 8px;
  font-size: 16px;
  color: #172b4d;
}

.asyncapi-dashboard ol,
.asyncapi-dashboard p {
  margin: 0;
  font-size: 14px;
}

.asyncapi-dashboard ol {
  padding-left: 24px;
}

.asyncapi-dashboard li {
  margin: 4px 0;
}

.asyncapi-dashboard code {
  background: #f4f5f7;
  padding: 2px 4px;
  border-radius: 3px;
  font-family: 'SF Mono', Monaco, monospace;
  font-size: 13px;
}

.asyncapi-dashboard a {
  color: #0052cc;
  text-decoration: none;
}

.asyncapi-dashboard a:hover {
  text-decoration: underline;
}
</style>
