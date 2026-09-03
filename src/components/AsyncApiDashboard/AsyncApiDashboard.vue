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
  - Archive is a PUT-based soft-delete: it writes status:'trashed' into the
    body JSON and appends " (Deleted)" to the title (see confirmDelete).
    v2 DELETE 401s for the legacy connect-authored content, and v2 exposes
    no dedicated archive status transition, so an in-place PUT — which the
    app is already authorized for — is the closest matching behaviour.
-->
<template>
  <div class="asyncapi-dashboard">
    <header class="dash-header">
      <div>
        <h2 class="dash-title">My API Documents</h2>
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
        <div class="create-split">
          <button class="btn btn-primary create-split-main" @click="toggleCreateMenu">
            + Create New API
            <span class="create-caret" aria-hidden="true">▾</span>
          </button>
          <div v-if="createMenuOpen" class="create-menu" role="menu">
            <button class="create-menu-item" role="menuitem" @click="createNew('asyncapi')">
              <span class="fmt-dot fmt-dot--asyncapi" aria-hidden="true"></span> AsyncAPI spec
            </button>
            <button class="create-menu-item" role="menuitem" @click="createNew('openapi')">
              <span class="fmt-dot fmt-dot--openapi" aria-hidden="true"></span> OpenAPI (Swagger) spec
            </button>
          </div>
        </div>
      </div>
    </header>

    <!-- Format tabs: slice the mixed list by spec family (All / AsyncAPI / OpenAPI). -->
    <div class="dash-tabs" role="tablist">
      <button
        v-for="tab in FORMAT_TABS"
        :key="tab.value"
        class="dash-tab"
        :class="{ 'dash-tab--active': formatFilter === tab.value }"
        role="tab"
        :aria-selected="formatFilter === tab.value"
        @click="setFormatFilter(tab.value)"
      >
        {{ tab.label }}
      </button>
    </div>

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
      Loading API documents…
    </div>

    <div v-else-if="error" class="dash-state dash-state--error">
      <h3>Error loading documents</h3>
      <p>{{ error }}</p>
      <button class="btn btn-primary" @click="refresh">Retry</button>
    </div>

    <div v-else-if="filteredDocs.length === 0" class="dash-state">
      <h3>No API documents yet</h3>
      <p v-if="searchTerm || formatFilter !== 'all'">Try adjusting your search or format filter.</p>
      <p v-else>Create your first AsyncAPI or OpenAPI document to get started.</p>
      <button v-if="!searchTerm && formatFilter === 'all'" class="btn btn-primary" @click="toggleCreateMenu">
        + Create New API
      </button>
    </div>

    <div v-else class="dash-grid">
      <article v-for="doc in filteredDocs" :key="doc.id" class="dash-card">
        <header class="card-header">
          <a class="card-title" href="#" @click.prevent="openView(doc)">
            {{ doc.displayTitle }}
          </a>
          <div class="card-header-right">
            <span
              class="fmt-badge"
              :class="doc.format === 'openapi' ? 'fmt-badge--openapi' : 'fmt-badge--asyncapi'"
            >{{ doc.format === 'openapi' ? 'OpenAPI' : 'AsyncAPI' }}</span>
            <button class="card-kebab" :title="'More actions'" aria-label="More actions" @click="toggleMenu(doc.id)">⋯</button>
          </div>
        </header>

        <div class="card-spec-line">
          <span><strong>API Version:</strong> {{ doc.apiVersion || '—' }}</span>
          <span class="card-spec-divider">•</span>
          <span><strong>Schema:</strong> {{ doc.format === 'openapi' ? 'OpenAPI' : 'AsyncAPI' }} {{ doc.schemaVersion || '—' }}</span>
        </div>

        <div class="card-badges">
          <span v-if="doc.rev != null" class="badge badge-rev">Rev {{ doc.rev }}</span>
          <span v-if="doc.id" class="badge badge-id">ID: {{ doc.id }}</span>
          <span v-if="doc.status && doc.status !== 'current'" class="badge badge-status">{{ doc.status }}</span>
        </div>

        <p v-if="doc.description" class="card-description">{{ doc.description }}</p>

        <div class="card-counts">
          <template v-if="doc.format === 'openapi'">
            <span v-if="doc.pathsCount != null" class="count-pill" :title="`${doc.pathsCount} paths`">
              <span class="count-icon" aria-hidden="true">🛣️</span>
              {{ doc.pathsCount }} path{{ doc.pathsCount === 1 ? '' : 's' }}
            </span>
            <span v-if="doc.operationsCount != null" class="count-pill" :title="`${doc.operationsCount} operations`">
              <span class="count-icon" aria-hidden="true">⚙️</span>
              {{ doc.operationsCount }} operation{{ doc.operationsCount === 1 ? '' : 's' }}
            </span>
          </template>
          <template v-else>
            <span v-if="doc.channelsCount != null" class="count-pill" :title="`${doc.channelsCount} channels`">
              <span class="count-icon" aria-hidden="true">📡</span>
              {{ doc.channelsCount }} channel{{ doc.channelsCount === 1 ? '' : 's' }}
            </span>
            <span v-if="doc.serversCount != null" class="count-pill" :title="`${doc.serversCount} servers`">
              <span class="count-icon" aria-hidden="true">🖥️</span>
              {{ doc.serversCount }} server{{ doc.serversCount === 1 ? '' : 's' }}
            </span>
          </template>
        </div>

        <div v-if="doc.pageLabel" class="card-page-ref">
          <span class="card-page-icon" aria-hidden="true">📄</span>
          Page:
          <a v-if="doc.pageUrl" :href="doc.pageUrl" target="_blank" rel="noopener" class="card-page-link" @click.prevent="openPage(doc)">
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
import { openModal, openUrl } from '@/model/globals/forgeGlobal'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'
import { derivePageUrl } from '@/model/asyncapi/derivePageUrl'
import { docMatchesSearch } from './docMatchesSearch'
import type { ICustomContent } from '@/model/ICustomContent'

interface AsyncApiDoc {
  id: string
  contentId?: string
  // Which spec family this doc is, derived from the stored value.diagramType.
  // Drives the format badge, the schema label ("AsyncAPI x" vs "OpenAPI x"), the
  // count pills (channels/servers vs paths/operations), and which editor/viewer
  // the View/Edit actions open (diagramType passed to openModal).
  format?: 'asyncapi' | 'openapi'
  title?: string
  displayTitle: string
  description?: string
  code?: string
  apiVersion?: string
  schemaVersion?: string
  channelsCount?: number
  serversCount?: number
  pathsCount?: number
  operationsCount?: number
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
// Dual-format dashboard: which spec family to show. Pairs with
// searchTerm/statusFilter in filteredDocs and drives the format tabs.
const formatFilter = ref<'all' | 'asyncapi' | 'openapi'>('all')
// "Create New API" split-button dropdown open state.
const createMenuOpen = ref(false)
const lastRefreshAt = ref<Date | null>(null)
const spaceKey = ref<string | null>(null)
const indexingNotice = ref(false)
const openMenuId = ref<string | null>(null)
let indexingTimeout: ReturnType<typeof setTimeout> | null = null

function toggleMenu(id: string) {
  openMenuId.value = openMenuId.value === id ? null : id
}

const FORMAT_TABS: { value: 'all' | 'asyncapi' | 'openapi'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'asyncapi', label: 'AsyncAPI' },
  { value: 'openapi', label: 'OpenAPI' },
]

function setFormatFilter(next: 'all' | 'asyncapi' | 'openapi') {
  if (formatFilter.value === next) return
  formatFilter.value = next
  trackAnalyticsEvent('dashboard_format_filtered', {
    feature_area: 'confluence',
    surface: 'dashboard',
    format_filter: next,
  })
}

function toggleCreateMenu() {
  createMenuOpen.value = !createMenuOpen.value
}

// HTTP verbs that count as OpenAPI operations under a path item.
const OPENAPI_METHODS = new Set(['get', 'put', 'post', 'delete', 'patch', 'options', 'head', 'trace'])

// Parse either an AsyncAPI or an OpenAPI/Swagger spec into the fields the card
// needs. Format is auto-detected from the schema key: OpenAPI 3.x uses `openapi`,
// Swagger 2.0 uses `swagger`, AsyncAPI uses `asyncapi`. `info.title/version/
// description` are common to both. The count fields diverge: AsyncAPI surfaces
// channels/servers, OpenAPI surfaces path count + total operation count.
function parseSpec(raw?: string): {
  format?: 'asyncapi' | 'openapi'
  apiVersion?: string
  schemaVersion?: string
  description?: string
  title?: string
  channelsCount?: number
  serversCount?: number
  pathsCount?: number
  operationsCount?: number
} {
  if (!raw) return {}
  try {
    const doc = yaml.load(raw) as Record<string, any> | null
    if (!doc || typeof doc !== 'object') return {}
    const info = (doc.info as Record<string, any>) || {}
    const common = {
      apiVersion: typeof info.version === 'string' ? info.version : undefined,
      description: typeof info.description === 'string' ? truncate(info.description, 180) : undefined,
      title: typeof info.title === 'string' ? info.title : undefined,
    }

    const openapiVersion =
      typeof doc.openapi === 'string' ? doc.openapi
      : typeof doc.swagger === 'string' ? doc.swagger
      : undefined
    if (openapiVersion) {
      const paths = (doc.paths as Record<string, any>) || undefined
      const pathKeys = paths && typeof paths === 'object' ? Object.keys(paths) : []
      let operations = 0
      for (const key of pathKeys) {
        const item = paths?.[key]
        if (item && typeof item === 'object') {
          for (const method of Object.keys(item)) {
            if (OPENAPI_METHODS.has(method.toLowerCase())) operations++
          }
        }
      }
      return {
        ...common,
        format: 'openapi',
        schemaVersion: openapiVersion,
        pathsCount: pathKeys.length,
        operationsCount: operations,
      }
    }

    const channels = (doc.channels as Record<string, any>) || undefined
    const servers = (doc.servers as Record<string, any>) || undefined
    return {
      ...common,
      format: 'asyncapi',
      schemaVersion: typeof doc.asyncapi === 'string' ? doc.asyncapi : undefined,
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

interface PageMeta {
  title?: string
  url?: string
}

// Session-scoped cache of pageId → { title, url }, populated lazily during
// loadDocuments(). The v2 custom-content list endpoint includes a top-level
// pageId but NO container link, so the card has no working page URL on its
// own — we look up each parent page separately to get both the title and a
// navigable URL. Cache survives across refresh() so the second load is
// instant for any page the user has already seen.
const pageMetaCache = new Map<string, PageMeta>()

async function fetchPageMeta(pageId: string): Promise<PageMeta> {
  const cached = pageMetaCache.get(pageId)
  if (cached) return cached
  try {
    const { requestConfluence } = await import('@forge/bridge')
    const resp = await requestConfluence(`/wiki/api/v2/pages/${pageId}`, {
      headers: { Accept: 'application/json' },
    })
    if (!resp.ok) return {}
    const page = await resp.json()
    const title = page?.title as string | undefined
    // Absolute page URL from `_links.base + _links.webui` (same source the
    // viewer's Copy-link uses). Without it the "Page:" reference has no href
    // and renders as dead text.
    const url = derivePageUrl(page)
    const meta: PageMeta = { title, url }
    if (title || url) pageMetaCache.set(pageId, meta)
    return meta
  } catch {
    return {}
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
        // Dual-format dashboard: keep AsyncAPI ('async*' — the enum is
        // 'AsyncAPI'; older builds used 'AsyncApi'; a future one might use
        // 'asyncapi') AND OpenAPI/Swagger ('openapi'/'swagger'). Both are stored
        // under the same async-api-doc custom-content type, so
        // searchCustomContent returns them together — anything else
        // (sequence/graph/embed) is dropped.
        const dt = typeof v.diagramType === 'string' ? v.diagramType.toLowerCase() : ''
        const isOpenApi = dt === 'openapi' || dt === 'swagger'
        if (!dt.startsWith('async') && !isOpenApi) return null
        const format: 'asyncapi' | 'openapi' = isOpenApi ? 'openapi' : 'asyncapi'

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
        const title = parsed.title || entry.title || v.title
          || (format === 'openapi' ? 'Untitled OpenAPI' : 'Untitled AsyncAPI')
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
          format,
          title,
          displayTitle: title,
          description: parsed.description || (v as any).description,
          code: v.code,
          apiVersion: parsed.apiVersion,
          schemaVersion: parsed.schemaVersion,
          channelsCount: parsed.channelsCount,
          serversCount: parsed.serversCount,
          pathsCount: parsed.pathsCount,
          operationsCount: parsed.operationsCount,
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
    // metadata, so we batch-fetch page title + URL in parallel and join them
    // back into pageLabel / pageUrl. Without this the tiles all show
    // "Page {id}" and the "Page:" reference has no working link. Failures are
    // swallowed (we fall back to "Page {id}", no link) so a single
    // missing/deleted page doesn't break the whole dashboard.
    const uniquePageIds = Array.from(
      new Set(documents.value.map((d) => d.pageId).filter((id): id is string => !!id)),
    )
    if (uniquePageIds.length) {
      const metas = await Promise.all(uniquePageIds.map(fetchPageMeta))
      const metaByPageId = new Map<string, PageMeta>()
      uniquePageIds.forEach((id, i) => metaByPageId.set(id, metas[i]))
      documents.value = documents.value.map((d) => {
        if (!d.pageId) return d
        const meta = metaByPageId.get(d.pageId)
        return {
          ...d,
          pageLabel: meta?.title || `Page ${d.pageId}`,
          pageUrl: meta?.url || d.pageUrl,
        }
      })
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
  if (formatFilter.value !== 'all') {
    list = list.filter((d) => (d.format || 'asyncapi') === formatFilter.value)
  }
  if (term) {
    // Title + description only (NOT the raw spec body) — see docMatchesSearch.
    list = list.filter((d) => docMatchesSearch(d, term))
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

async function createNew(format: 'asyncapi' | 'openapi' = 'asyncapi') {
  createMenuOpen.value = false
  // Funnel entry: which format the user chose from the split-button menu. The
  // editor then emits its own macro_create_started/succeeded with this macro_type.
  trackAnalyticsEvent('dashboard_create_selected', {
    feature_area: 'confluence',
    surface: 'dashboard',
    macro_type: format,
    operation_mode: 'create',
  })
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
        diagramType: format,
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
        diagramType: doc.format || 'asyncapi',
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
        diagramType: doc.format || 'asyncapi',
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

async function openPage(doc: AsyncApiDoc) {
  // Inside the Forge OOPIF a plain <a target="_blank"> to a product URL is
  // unreliable (sandboxed) — route through Forge's router (openUrl → router.open)
  // so the hosting Confluence page actually opens in a new tab.
  if (!doc.pageUrl) return
  trackAnalyticsEvent('asyncapi_dashboard_page_opened', {
    feature_area: 'confluence',
    surface: 'dashboard',
    macro_type: 'asyncapi',
    entry_point: 'dashboard',
    page_id: doc.pageId,
    custom_content_id: doc.contentId,
  })
  try {
    await openUrl(doc.pageUrl)
  } catch (err) {
    console.error('Failed to open page from dashboard:', err)
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

/* --- Dual-format dashboard: format tabs, Create split-menu, format badges --- */
.create-split {
  position: relative;
  display: inline-flex;
}
.create-split-main {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.create-caret {
  font-size: 10px;
  opacity: 0.9;
}
.create-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  min-width: 220px;
  background: #fff;
  border: 1px solid #dfe1e6;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(9, 30, 66, 0.15);
  padding: 4px;
  z-index: 20;
}
.create-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  background: transparent;
  border-radius: 4px;
  font-size: 14px;
  color: #172b4d;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
}
.create-menu-item:hover { background: #f4f5f7; }
.fmt-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: 0 0 auto;
}
.fmt-dot--asyncapi { background: #36b37e; }
.fmt-dot--openapi { background: #ff8b00; }

.dash-tabs {
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  background: #f4f5f7;
  border-radius: 6px;
  margin-bottom: 16px;
}
.dash-tab {
  border: none;
  background: transparent;
  padding: 6px 16px;
  border-radius: 4px;
  font-size: 14px;
  color: #42526e;
  cursor: pointer;
  font-family: inherit;
}
.dash-tab:hover { color: #172b4d; }
.dash-tab--active {
  background: #fff;
  color: #0052cc;
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(9, 30, 66, 0.1);
}

.card-header-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
}
.fmt-badge {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.02em;
  padding: 2px 8px;
  border-radius: 10px;
  white-space: nowrap;
}
.fmt-badge--asyncapi {
  background: #e3fcef;
  color: #006644;
}
.fmt-badge--openapi {
  background: #fff7e5;
  color: #974f00;
}
</style>
