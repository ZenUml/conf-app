<!--
  AsyncAPI variant space-app dashboard. Lists AsyncAPI specs in the current
  space and provides Create / View / Edit / Archive actions. Matches the
  visual layout of the legacy AsyncAPI-Conf-V2 DocumentList so users
  upgrading from the standalone app see the same chrome:

  - Header reports document count + current space key + last refresh time
  - Each card parses the stored spec (YAML or JSON) to surface API version,
    AsyncAPI schema version, description, and channel/server counts. We
    avoid extra API fetches by reading from the body that searchCustomContent
    already returns.
  - "Rev N" comes from custom-content v2 version.number; "ID" is the
    custom-content id.
  - Archive is wired to the same DELETE that the old Delete button used —
    custom-content v2 doesn't expose a dedicated archive status transition,
    so DELETE (which trashes the content, restorable from Confluence) is
    the closest matching behaviour.
-->
<template>
  <div class="asyncapi-dashboard">
    <header class="dash-header">
      <div>
        <h2 class="dash-title">AsyncAPI Documents</h2>
        <p class="dash-meta">
          <span>{{ filteredDocs.length }} document{{ filteredDocs.length === 1 ? '' : 's' }} found</span>
          <span v-if="spaceKey"> in space {{ spaceKey }}</span>
          <span v-if="lastRefreshLabel" class="dash-meta-sub">· Last updated: {{ lastRefreshLabel }}</span>
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
      <select v-model="statusFilter" class="dash-select">
        <option value="all">All Documents</option>
        <option value="current">Active</option>
        <option value="archived">Archived</option>
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
          <a class="card-title" href="#" @click.prevent="openView(doc)">
            {{ doc.displayTitle }}
          </a>
          <button class="card-kebab" :title="'More actions'" aria-label="More actions" @click="toggleMenu(doc.id)">⋯</button>
        </header>

        <div class="card-spec-line">
          <span><strong>API Version:</strong> {{ doc.apiVersion || '—' }}</span>
          <span class="card-spec-divider">•</span>
          <span><strong>Schema:</strong> AsyncAPI {{ doc.schemaVersion || '—' }}</span>
        </div>

        <div class="card-badges">
          <span v-if="doc.rev != null" class="badge badge-rev">Rev {{ doc.rev }}</span>
          <span v-if="doc.id" class="badge badge-id">ID: {{ doc.id }}</span>
          <span v-if="doc.status && doc.status !== 'current'" class="badge badge-status">{{ doc.status }}</span>
        </div>

        <p v-if="doc.description" class="card-description">{{ doc.description }}</p>

        <div class="card-counts">
          <span v-if="doc.channelsCount != null" class="count-pill" :title="`${doc.channelsCount} channels`">
            <span class="count-icon" aria-hidden="true">📡</span>
            {{ doc.channelsCount }} channel{{ doc.channelsCount === 1 ? '' : 's' }}
          </span>
          <span v-if="doc.serversCount != null" class="count-pill" :title="`${doc.serversCount} servers`">
            <span class="count-icon" aria-hidden="true">🖥️</span>
            {{ doc.serversCount }} server{{ doc.serversCount === 1 ? '' : 's' }}
          </span>
        </div>

        <div v-if="doc.pageLabel" class="card-page-ref">
          <span class="card-page-icon" aria-hidden="true">📄</span>
          Page:
          <a v-if="doc.pageUrl" :href="doc.pageUrl" target="_blank" rel="noopener" class="card-page-link">
            {{ doc.pageLabel }} →
          </a>
          <span v-else class="card-page-link">{{ doc.pageLabel }}</span>
        </div>

        <footer class="card-footer">
          <div class="card-timestamps">
            <span class="card-timestamp">{{ doc.createdLabel || 'Created time unrecorded' }}</span>
            <span class="card-timestamp">{{ doc.updatedLabel || 'Updated time unrecorded' }}</span>
          </div>
          <div class="card-actions">
            <button class="btn btn-view" @click="openView(doc)">View</button>
            <button class="btn btn-edit" @click="openEdit(doc)">Edit</button>
            <span class="card-actions-spacer"></span>
            <button class="btn btn-archive" @click="confirmDelete(doc)">
              <span aria-hidden="true">📦</span> Archive
            </button>
          </div>
        </footer>
      </article>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import yaml from 'js-yaml'
import globals from '@/model/globals'
import { openModal } from '@/model/globals/forgeGlobal'
import type { ICustomContent } from '@/model/ICustomContent'

interface AsyncApiDoc {
  id: string
  contentId?: string
  title?: string
  displayTitle: string
  description?: string
  code?: string
  apiVersion?: string
  schemaVersion?: string
  channelsCount?: number
  serversCount?: number
  rev?: number
  status?: string
  createdAt?: string
  updatedAt?: string
  createdLabel?: string
  updatedLabel?: string
  pageId?: string
  pageLabel?: string
  pageUrl?: string
}

const documents = ref<AsyncApiDoc[]>([])
const loading = ref(true)
const refreshing = ref(false)
const error = ref<string | null>(null)
const searchTerm = ref('')
const sortBy = ref<'updated' | 'created' | 'name'>('updated')
// Default to 'current' so archived/trashed docs are hidden until the
// user explicitly switches to "Archived" or "All Documents". Matches
// the way the legacy AsyncAPI-Conf-V2 dashboard treated soft-deleted
// records.
const statusFilter = ref<'all' | 'current' | 'archived'>('current')
const lastRefreshAt = ref<Date | null>(null)
const spaceKey = ref<string | null>(null)
const indexingNotice = ref(false)
const openMenuId = ref<string | null>(null)
let indexingTimeout: ReturnType<typeof setTimeout> | null = null

function toggleMenu(id: string) {
  openMenuId.value = openMenuId.value === id ? null : id
}

function parseSpec(raw?: string): {
  apiVersion?: string
  schemaVersion?: string
  description?: string
  title?: string
  channelsCount?: number
  serversCount?: number
} {
  if (!raw) return {}
  try {
    const doc = yaml.load(raw) as Record<string, any> | null
    if (!doc || typeof doc !== 'object') return {}
    const info = (doc.info as Record<string, any>) || {}
    const channels = (doc.channels as Record<string, any>) || undefined
    const servers = (doc.servers as Record<string, any>) || undefined
    return {
      apiVersion: typeof info.version === 'string' ? info.version : undefined,
      schemaVersion: typeof doc.asyncapi === 'string' ? doc.asyncapi : undefined,
      description: typeof info.description === 'string'
        ? truncate(info.description, 180)
        : undefined,
      title: typeof info.title === 'string' ? info.title : undefined,
      channelsCount: channels && typeof channels === 'object' ? Object.keys(channels).length : undefined,
      serversCount: servers && typeof servers === 'object' ? Object.keys(servers).length : undefined,
    }
  } catch {
    return {}
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max).trimEnd() + '…' : s
}

// Session-scoped cache of pageId → page title, populated lazily during
// loadDocuments(). The v2 custom-content list endpoint doesn't include
// container metadata, so we have to look up each parent page separately.
// Cache survives across refresh() so the second load is instant for any
// page the user has already seen.
const pageTitleCache = new Map<string, string>()

async function fetchPageTitle(pageId: string): Promise<string | undefined> {
  if (pageTitleCache.has(pageId)) return pageTitleCache.get(pageId)
  try {
    const { requestConfluence } = await import('@forge/bridge')
    const resp = await requestConfluence(`/wiki/api/v2/pages/${pageId}`, {
      headers: { Accept: 'application/json' },
    })
    if (!resp.ok) return undefined
    const page = await resp.json()
    const title = page?.title as string | undefined
    if (title) pageTitleCache.set(pageId, title)
    return title
  } catch {
    return undefined
  }
}

function formatTime(iso?: string, prefix?: string): string | undefined {
  if (!iso) return undefined
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return undefined
  const formatted = d.toLocaleString([], {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
  return prefix ? `${prefix} ${formatted}` : formatted
}

async function loadDocuments(isRefresh = false): Promise<void> {
  if (isRefresh) refreshing.value = true
  else loading.value = true
  error.value = null

  try {
    const results: ICustomContent[] = await globals.apWrapper.searchCustomContent()
    documents.value = results
      .map((entry: any) => {
        const v = entry.value as (AsyncApiDoc & { diagramType?: string }) | undefined
        if (!v) return null
        // Case-insensitive match: stored data spans 'AsyncAPI' (current
        // enum), 'AsyncApi' (older intermediate builds), and 'asyncapi'
        // (potential future). Match any 'async*' diagramType.
        const dt = typeof v.diagramType === 'string' ? v.diagramType.toLowerCase() : ''
        if (!dt.startsWith('async')) return null

        const parsed = parseSpec(v.code)
        const id = String(entry.id ?? v.id ?? Math.random())
        // Prefer the spec's `info.title` over the custom-content title.
        // The spec body is what the user actually edits in the Studio, so
        // info.title always reflects the latest user-entered name. The
        // custom-content title only updates if the editor's save flow
        // successfully writes it — and we've observed it lagging behind
        // when a doc is edited from the dashboard (the body code updates
        // but the top-level title doesn't). Reading from parsed.title
        // first means the dashboard card surfaces the user-chosen name
        // immediately, regardless of whether the title write race-loses.
        const title = parsed.title || entry.title || v.title || 'Untitled AsyncAPI'
        // Status precedence: the body's `status` field is the source of
        // truth for archived/trashed (Archive sets it via PUT — see
        // confirmDelete). Fall back to the v2 record's top-level
        // `status` only when the body doesn't carry one.
        const status = (v as any).status as string | undefined
          || (entry as any).status as string | undefined
        const createdAt = (entry as any).createdAt as string | undefined
        const updatedAt = (entry.version && (entry.version.createdAt as string)) || undefined
        const pageId = (entry as any).pageId ? String((entry as any).pageId) : undefined
        const containerTitle = entry.container?.title as string | undefined
        const containerLink = entry.container?.link as string | undefined

        return {
          id,
          contentId: String(entry.id ?? ''),
          title,
          displayTitle: title,
          description: parsed.description || (v as any).description,
          code: v.code,
          apiVersion: parsed.apiVersion,
          schemaVersion: parsed.schemaVersion,
          channelsCount: parsed.channelsCount,
          serversCount: parsed.serversCount,
          rev: (entry.version && (entry.version.number as number)) || undefined,
          status,
          createdAt,
          updatedAt,
          createdLabel: formatTime(createdAt, 'Created'),
          updatedLabel: formatTime(updatedAt, 'Updated'),
          pageId,
          pageLabel: containerTitle || (pageId ? `Page ${pageId}` : undefined),
          pageUrl: containerLink,
        } as AsyncApiDoc
      })
      .filter((d): d is AsyncApiDoc => d !== null)

    // The v2 custom-content list response doesn't include parent-page
    // metadata, so we batch-fetch page titles in parallel and join them
    // back into pageLabel. Without this the tiles all show "Page {id}".
    // Failures are swallowed (we fall back to "Page {id}") so a single
    // missing/deleted page doesn't break the whole dashboard.
    const uniquePageIds = Array.from(
      new Set(documents.value.map((d) => d.pageId).filter((id): id is string => !!id)),
    )
    if (uniquePageIds.length) {
      const titles = await Promise.all(uniquePageIds.map(fetchPageTitle))
      const titleByPageId = new Map<string, string>()
      uniquePageIds.forEach((id, i) => {
        const t = titles[i]
        if (t) titleByPageId.set(id, t)
      })
      documents.value = documents.value.map((d) => ({
        ...d,
        pageLabel: d.pageId
          ? titleByPageId.get(d.pageId) || `Page ${d.pageId}`
          : d.pageLabel,
      }))
    }

    // Capture current space key for header subtitle ("found in space ZEN").
    try {
      const space = await globals.apWrapper.getCurrentSpace()
      spaceKey.value = space?.key ?? null
    } catch {
      spaceKey.value = null
    }
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
  const status = statusFilter.value
  let list = documents.value
  if (status !== 'all') {
    list = list.filter((d) => {
      const s = (d.status || 'current').toLowerCase()
      return status === 'current' ? s === 'current' : s === 'archived' || s === 'trashed'
    })
  }
  if (term) {
    list = list.filter(
      (d) =>
        (d.displayTitle || '').toLowerCase().includes(term) ||
        (d.description || '').toLowerCase().includes(term) ||
        (d.code || '').toLowerCase().includes(term),
    )
  }
  return [...list].sort((a, b) => {
    switch (sortBy.value) {
      case 'name':
        return (a.displayTitle || '').localeCompare(b.displayTitle || '')
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
      // Fullscreen modal removes Confluence's modal chrome wrapper so the
      // editor / viewer fills the viewport — matches the standalone
      // AsyncAPI-Conf-V2 experience. AsyncApiStudioEditor's own
      // ownTitleBar mode then renders the title + Publish header inside
      // the iframe.
      size: 'fullscreen',
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
      // Fullscreen modal removes Confluence's modal chrome wrapper so the
      // editor / viewer fills the viewport — matches the standalone
      // AsyncAPI-Conf-V2 experience. AsyncApiStudioEditor's own
      // ownTitleBar mode then renders the title + Publish header inside
      // the iframe.
      size: 'fullscreen',
      context: {
        macroMode: 'viewer',
        diagramType: 'asyncapi',
        customContentId: doc.contentId,
      },
      onClose: (payload: { action?: string } | undefined) => {
        if (payload?.action === 'edit') {
          void openEdit(doc)
        } else {
          void loadDocuments(true)
        }
      },
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
      // Fullscreen modal removes Confluence's modal chrome wrapper so the
      // editor / viewer fills the viewport — matches the standalone
      // AsyncAPI-Conf-V2 experience. AsyncApiStudioEditor's own
      // ownTitleBar mode then renders the title + Publish header inside
      // the iframe.
      size: 'fullscreen',
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
    `Archive "${doc.displayTitle}"? The document will be marked archived; you can restore it later by editing the entry's title back.`,
  )
  if (!confirmed) return

  try {
    // Soft-delete via PUT, not HTTP DELETE.
    //
    // We initially used DELETE /wiki/api/v2/custom-content/{id} but it
    // returned 401 over the Forge bridge: the app's `write:custom-content
    // :confluence` scope grants create/update permission for content the
    // app owns, but the v2 DELETE endpoint requires the caller to be the
    // content's author or a content admin — and `ac:my-api:async-api-doc`
    // records that pre-date the Forge migration were authored by the
    // legacy Connect app's runtime account, not by the user / current
    // Forge app, so DELETE 401s.
    //
    // The standalone AsyncAPI-Conf-V2 worked around this with a PUT
    // update that marks the body's status as 'trashed' and appends
    // " (Deleted)" to the title — same record, same author, no delete
    // permission needed. That's the path here too: load the existing v2
    // record, PUT a new version with `status: 'trashed'` in the body
    // and the title suffix, increment version. Dashboard search then
    // filters by parsed body.status when the user picks "Active" in the
    // status dropdown.
    const { requestConfluence } = await import('@forge/bridge')
    const getResp = await requestConfluence(
      `/wiki/api/v2/custom-content/${doc.contentId}?body-format=raw`,
      { method: 'GET', headers: { Accept: 'application/json' } },
    )
    if (!getResp.ok) {
      throw new Error(`Archive failed: load returned HTTP ${getResp.status}`)
    }
    const existing = await getResp.json()
    let existingBody: any = {}
    try {
      existingBody = JSON.parse(existing.body?.raw?.value || '{}')
    } catch {
      existingBody = {}
    }
    const newBody = {
      ...existingBody,
      status: 'trashed',
      // Drop legacy `schema` if present (Conf-V2 carried both `code` and
      // `schema`; current variant only uses `code`).
      schema: undefined,
    }
    const cleanTitle = doc.displayTitle.replace(/\s*\(Deleted\)\s*$/, '')
    const putBody: any = {
      id: existing.id,
      type: existing.type,
      status: 'current',
      title: `${cleanTitle} (Deleted)`,
      body: {
        value: JSON.stringify(newBody),
        representation: 'raw',
      },
      version: { number: (existing.version?.number || 0) + 1 },
    }
    if (existing.pageId) putBody.pageId = existing.pageId
    else if (existing.spaceId) putBody.spaceId = existing.spaceId
    const putResp = await requestConfluence(`/wiki/api/v2/custom-content/${doc.contentId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(putBody),
    })
    if (!putResp.ok) {
      throw new Error(`Archive failed: HTTP ${putResp.status}`)
    }
    // Optimistic local update: remove the card from the in-memory list
    // and trigger a refresh.
    documents.value = documents.value.filter((d) => d.id !== doc.id)
    await loadDocuments(true)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error('Failed to archive AsyncAPI document:', err)
    window.alert('Failed to archive document: ' + msg)
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
  max-width: 1280px;
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

.btn-view,
.btn-edit,
.btn-archive {
  background: #fff;
  border: 1px solid #dfe1e6;
  color: #42526e;
  padding: 6px 12px;
  font-size: 13px;
}
.btn-view { color: #0052cc; border-color: #0052cc; }
.btn-view:hover { background: #deebff; }
.btn-edit:hover { background: #f4f5f7; }
.btn-archive { color: #5e6c84; }
.btn-archive:hover { background: #f4f5f7; }

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
  min-width: 150px;
}

.dash-state {
  text-align: center;
  padding: 40px 20px;
  color: #6b778c;
}
.dash-state h3 { margin: 0 0 8px; color: #172b4d; }
.dash-state--error {
  background: #ffebe6;
  color: #de350b;
  border: 1px solid #ffbdad;
  border-radius: 4px;
}

.dash-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
  gap: 16px;
}

.dash-card {
  background: #fff;
  border: 1px solid #dfe1e6;
  border-radius: 6px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  box-shadow: 0 1px 1px rgba(9, 30, 66, 0.04);
}

.card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.card-title {
  margin: 0;
  color: #0052cc;
  font-size: 16px;
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
  word-break: break-word;
}
.card-title:hover { text-decoration: underline; }

.card-kebab {
  background: transparent;
  border: none;
  color: #6b778c;
  font-size: 18px;
  cursor: pointer;
  padding: 0 6px;
  line-height: 1;
}
.card-kebab:hover { color: #172b4d; }

.card-spec-line {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 13px;
  color: #42526e;
}
.card-spec-line strong { font-weight: 600; color: #172b4d; }
.card-spec-divider { color: #c1c7d0; }

.card-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.badge {
  display: inline-block;
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 3px;
  font-family: 'SF Mono', Monaco, monospace;
}
.badge-rev {
  background: #deebff;
  color: #0052cc;
}
.badge-id {
  background: #f4f5f7;
  color: #5e6c84;
}
.badge-status {
  background: #fff7e5;
  color: #974f00;
  text-transform: capitalize;
}

.card-description {
  margin: 0;
  color: #42526e;
  font-size: 13px;
  line-height: 1.4;
  min-height: 40px;
}

.card-counts {
  display: flex;
  gap: 14px;
  font-size: 13px;
  color: #5e6c84;
}
.count-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.count-icon { font-size: 13px; }

.card-page-ref {
  background: #f4f5f7;
  border-radius: 4px;
  padding: 6px 10px;
  font-size: 12px;
  color: #5e6c84;
  display: flex;
  gap: 6px;
  align-items: center;
}
.card-page-icon { font-size: 12px; }
.card-page-link {
  color: #0052cc;
  text-decoration: none;
}
.card-page-link:hover { text-decoration: underline; }

.card-footer {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-top: 1px solid #f4f5f7;
  padding-top: 10px;
}

.card-timestamps {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  font-size: 11px;
  font-style: italic;
  color: #97a0af;
}

.card-actions {
  display: flex;
  gap: 6px;
  align-items: center;
}
.card-actions-spacer { flex: 1; }
</style>
