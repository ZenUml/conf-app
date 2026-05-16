<!--
  AsyncAPI variant space-app dashboard. Lists AsyncAPI specs the user has
  saved across the site, plus Create/View/Edit/Delete actions. Mirrors the
  feature set of AsyncAPI-Conf-V2's list.tsx + DocumentList.tsx so users
  upgrading from the standalone app don't lose the workflow.

  Implementation notes:
  - Uses globals.apWrapper.searchCustomContent() to find all custom content
    in the current container (Confluence scopes this to the user's spaces).
    Filtered client-side to diagramType === DiagramType.AsyncApi.
  - Create / View / Edit open the asyncapi editor or viewer via openModal
    from @/model/globals/forgeGlobal — the modal context carries
    macroMode + diagramType so forgeIndex.ts dispatches correctly.
  - Delete uses Confluence REST v2 DELETE on custom-content (soft delete /
    move to trash). No host helper exists yet, so we requestConfluence
    directly.
-->
<template>
  <div class="asyncapi-dashboard">
    <header class="dash-header">
      <div>
        <h2 class="dash-title">My API Documents</h2>
        <p class="dash-meta">
          {{ filteredDocs.length }} document{{ filteredDocs.length === 1 ? '' : 's' }}
          <span v-if="lastRefreshLabel" class="dash-meta-sub">· Last refreshed {{ lastRefreshLabel }}</span>
        </p>
      </div>
      <div class="dash-actions">
        <button class="btn btn-secondary" :disabled="refreshing" @click="refresh">
          {{ refreshing ? 'Refreshing…' : '↻ Refresh' }}
        </button>
        <button class="btn btn-primary" @click="createNew">+ Create New API</button>
      </div>
    </header>

    <div v-if="indexingNotice" class="indexing-notice">
      ℹ️ Your document has been saved. It may take a few moments to appear in the list while Confluence indexes it.
    </div>

    <div class="dash-filters">
      <input
        v-model="searchTerm"
        type="text"
        placeholder="Search documents…"
        class="dash-search"
      />
      <select v-model="sortBy" class="dash-select">
        <option value="updated">Sort by Updated</option>
        <option value="created">Sort by Created</option>
        <option value="name">Sort by Name</option>
      </select>
    </div>

    <div v-if="loading" class="dash-state">
      Loading AsyncAPI documents…
    </div>

    <div v-else-if="error" class="dash-state dash-state--error">
      <h3>Error loading documents</h3>
      <p>{{ error }}</p>
      <button class="btn btn-primary" @click="refresh">Retry</button>
    </div>

    <div v-else-if="filteredDocs.length === 0" class="dash-state">
      <h3>No AsyncAPI documents yet</h3>
      <p v-if="searchTerm">Try adjusting your search.</p>
      <p v-else>Create your first AsyncAPI document to get started.</p>
      <button v-if="!searchTerm" class="btn btn-primary" @click="createNew">
        + Create First Document
      </button>
    </div>

    <div v-else class="dash-grid">
      <article v-for="doc in filteredDocs" :key="doc.id" class="dash-card">
        <header class="card-header">
          <h3 class="card-title">{{ doc.title || 'Untitled AsyncAPI' }}</h3>
          <span v-if="doc.container?.title" class="card-container">
            On page: {{ doc.container.title }}
          </span>
        </header>
        <p v-if="doc.description" class="card-description">{{ doc.description }}</p>
        <pre v-else class="card-code-preview">{{ codePreview(doc.code) }}</pre>
        <footer class="card-footer">
          <div class="card-actions">
            <button class="btn btn-link" @click="openView(doc)">View</button>
            <button class="btn btn-link" @click="openEdit(doc)">Edit</button>
            <button class="btn btn-link btn-danger" @click="confirmDelete(doc)">Delete</button>
          </div>
        </footer>
      </article>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import globals from '@/model/globals'
import { openModal } from '@/model/globals/forgeGlobal'
import { DiagramType } from '@/model/Diagram/Diagram'
import type { ICustomContent } from '@/model/ICustomContent'

interface AsyncApiDoc {
  id: string
  contentId?: string
  title?: string
  description?: string
  code?: string
  createdAt?: string | number | Date
  updatedAt?: string | number | Date
  container?: { id: string; type: string; title?: string }
}

const documents = ref<AsyncApiDoc[]>([])
const loading = ref(true)
const refreshing = ref(false)
const error = ref<string | null>(null)
const searchTerm = ref('')
const sortBy = ref<'updated' | 'created' | 'name'>('updated')
const lastRefreshAt = ref<Date | null>(null)
const indexingNotice = ref(false)
let indexingTimeout: ReturnType<typeof setTimeout> | null = null

async function loadDocuments(isRefresh = false): Promise<void> {
  if (isRefresh) refreshing.value = true
  else loading.value = true
  error.value = null

  try {
    const results: ICustomContent[] = await globals.apWrapper.searchCustomContent()
    documents.value = results
      .map((entry) => {
        const v = entry.value as AsyncApiDoc & { diagramType?: string }
        if (!v) return null
        if (v.diagramType !== DiagramType.AsyncApi) return null
        return {
          id: entry.id || v.id || String(Math.random()),
          contentId: entry.id,
          title: entry.title || v.title,
          description: v.description,
          code: v.code,
          // Cloudflare-side timestamps don't ship through searchCustomContent;
          // fall back to whatever timestamps the stored Diagram carries.
          createdAt: (v as any).createdAt,
          updatedAt: (v as any).updatedAt,
          container: entry.container ? {
            id: entry.container.id,
            type: entry.container.type,
            title: entry.container.title,
          } : undefined,
        } as AsyncApiDoc
      })
      .filter((d): d is AsyncApiDoc => d !== null)
    lastRefreshAt.value = new Date()
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to load documents'
    error.value = msg
    console.error('AsyncAPI dashboard load failed:', err)
  } finally {
    loading.value = false
    refreshing.value = false
  }
}

const filteredDocs = computed(() => {
  const term = searchTerm.value.trim().toLowerCase()
  const filtered = term
    ? documents.value.filter(
        (d) =>
          (d.title || '').toLowerCase().includes(term) ||
          (d.description || '').toLowerCase().includes(term) ||
          (d.code || '').toLowerCase().includes(term),
      )
    : documents.value
  return [...filtered].sort((a, b) => {
    switch (sortBy.value) {
      case 'name':
        return (a.title || '').localeCompare(b.title || '')
      case 'created':
        return new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()
      case 'updated':
      default:
        return new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime()
    }
  })
})

const lastRefreshLabel = computed(() => {
  if (!lastRefreshAt.value) return null
  return lastRefreshAt.value.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
})

function codePreview(code?: string): string {
  if (!code) return ''
  return code.length > 240 ? code.slice(0, 240) + '…' : code
}

function showIndexingNotice() {
  indexingNotice.value = true
  if (indexingTimeout) clearTimeout(indexingTimeout)
  indexingTimeout = setTimeout(() => {
    indexingNotice.value = false
  }, 8000)
}

async function refresh() {
  await loadDocuments(true)
}

async function createNew() {
  try {
    await openModal({
      resource: 'main',
      size: 'max',
      context: {
        macroMode: 'editor',
        diagramType: 'asyncapi',
      },
      onClose: async () => {
        showIndexingNotice()
        await loadDocuments(true)
      },
    })
  } catch (err) {
    console.error('Failed to open Create modal:', err)
  }
}

async function openView(doc: AsyncApiDoc) {
  if (!doc.contentId) return
  try {
    await openModal({
      resource: 'main',
      size: 'max',
      context: {
        macroMode: 'viewer',
        diagramType: 'asyncapi',
        customContentId: doc.contentId,
      },
      onClose: () => loadDocuments(true),
    })
  } catch (err) {
    console.error('Failed to open View modal:', err)
  }
}

async function openEdit(doc: AsyncApiDoc) {
  if (!doc.contentId) return
  try {
    await openModal({
      resource: 'main',
      size: 'max',
      context: {
        macroMode: 'editor',
        diagramType: 'asyncapi',
        customContentId: doc.contentId,
      },
      onClose: async () => {
        showIndexingNotice()
        await loadDocuments(true)
      },
    })
  } catch (err) {
    console.error('Failed to open Edit modal:', err)
  }
}

async function confirmDelete(doc: AsyncApiDoc) {
  if (!doc.contentId) return
  const confirmed = window.confirm(
    `Delete "${doc.title || 'this AsyncAPI document'}"? It will be moved to trash and can be restored from Confluence.`,
  )
  if (!confirmed) return

  try {
    // Confluence Cloud REST v2 doesn't expose a soft-delete endpoint for
    // custom content directly; deleting moves it to trash by default.
    const { requestConfluence } = await import('@forge/bridge')
    const response = await requestConfluence(`/wiki/api/v2/custom-content/${doc.contentId}`, {
      method: 'DELETE',
    })
    if (!response.ok && response.status !== 204) {
      throw new Error(`Delete failed: HTTP ${response.status}`)
    }
    // Optimistic local update; refresh in background.
    documents.value = documents.value.filter((d) => d.id !== doc.id)
    await loadDocuments(true)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error('Failed to delete AsyncAPI document:', err)
    window.alert('Failed to delete document: ' + msg)
  }
}

function handleFocus() {
  void loadDocuments(true)
}

onMounted(async () => {
  await globals.apWrapper.initializeContext()
  await loadDocuments()
  window.addEventListener('focus', handleFocus)
})

onUnmounted(() => {
  window.removeEventListener('focus', handleFocus)
  if (indexingTimeout) clearTimeout(indexingTimeout)
})
</script>

<style scoped>
.asyncapi-dashboard {
  max-width: 1200px;
  margin: 0 auto;
  padding: 24px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: #172b4d;
  min-height: 100vh;
}

.dash-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}

.dash-title {
  margin: 0;
  color: #0052cc;
  font-size: 22px;
}

.dash-meta {
  margin: 4px 0 0;
  color: #6b778c;
  font-size: 13px;
}

.dash-meta-sub {
  color: #97a0af;
  font-size: 12px;
  margin-left: 6px;
}

.dash-actions {
  display: flex;
  gap: 8px;
}

.btn {
  border-radius: 4px;
  padding: 8px 14px;
  font-size: 14px;
  cursor: pointer;
  border: 1px solid transparent;
  font-family: inherit;
  white-space: nowrap;
}

.btn-primary {
  background: #0052cc;
  color: #fff;
}

.btn-primary:hover { background: #0747a6; }

.btn-secondary {
  background: #fff;
  color: #42526e;
  border-color: #dfe1e6;
}

.btn-secondary:hover { background: #f4f5f7; }
.btn-secondary:disabled { opacity: 0.6; cursor: not-allowed; }

.btn-link {
  background: transparent;
  color: #0052cc;
  padding: 4px 8px;
  font-size: 13px;
}

.btn-link:hover { text-decoration: underline; }
.btn-danger { color: #de350b; }

.indexing-notice {
  padding: 10px 14px;
  background: #e3fcef;
  color: #006644;
  border: 1px solid #abf5d1;
  border-radius: 4px;
  margin-bottom: 16px;
  font-size: 13px;
}

.dash-filters {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
  padding: 12px;
  background: #fff;
  border: 1px solid #dfe1e6;
  border-radius: 6px;
}

.dash-search {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid #dfe1e6;
  border-radius: 4px;
  font-size: 14px;
}

.dash-select {
  padding: 8px 12px;
  border: 1px solid #dfe1e6;
  border-radius: 4px;
  font-size: 14px;
  background: #fff;
}

.dash-state {
  text-align: center;
  padding: 40px 20px;
  color: #6b778c;
}

.dash-state h3 {
  margin: 0 0 8px;
  color: #172b4d;
}

.dash-state--error {
  background: #ffebe6;
  color: #de350b;
  border: 1px solid #ffbdad;
  border-radius: 4px;
}

.dash-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}

.dash-card {
  background: #fff;
  border: 1px solid #dfe1e6;
  border-radius: 6px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.card-title {
  margin: 0;
  color: #172b4d;
  font-size: 16px;
}

.card-container {
  display: block;
  font-size: 12px;
  color: #6b778c;
  margin-top: 4px;
}

.card-description {
  margin: 0;
  color: #42526e;
  font-size: 13px;
  line-height: 1.4;
}

.card-code-preview {
  margin: 0;
  background: #f4f5f7;
  border-radius: 3px;
  padding: 8px;
  font-size: 11px;
  font-family: 'SF Mono', Monaco, monospace;
  color: #5e6c84;
  max-height: 80px;
  overflow: hidden;
  white-space: pre-wrap;
}

.card-footer {
  margin-top: auto;
}

.card-actions {
  display: flex;
  gap: 4px;
  border-top: 1px solid #f4f5f7;
  padding-top: 8px;
}
</style>
