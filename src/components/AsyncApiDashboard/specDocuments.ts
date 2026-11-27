import yaml from 'js-yaml'
import type { ICustomContent } from '@/model/ICustomContent'

export interface SpecSummary {
  format?: 'asyncapi' | 'openapi'
  apiVersion?: string
  schemaVersion?: string
  description?: string
  title?: string
  channelsCount?: number
  serversCount?: number
  pathsCount?: number
  operationsCount?: number
}

export interface AsyncApiDoc {
  id: string
  contentId?: string
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

const OPENAPI_METHODS = new Set(['get', 'put', 'post', 'delete', 'patch', 'options', 'head', 'trace'])

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max).trimEnd() + '…' : s
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

// Parse either an AsyncAPI or an OpenAPI/Swagger spec into the fields the card
// needs. Format is auto-detected from the schema key: OpenAPI 3.x uses `openapi`,
// Swagger 2.0 uses `swagger`, AsyncAPI uses `asyncapi`. `info.title/version/
// description` are common to both. The count fields diverge: AsyncAPI surfaces
// channels/servers, OpenAPI surfaces path count + total operation count.
export function parseSpecSummary(raw?: string): SpecSummary {
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

// Map one searchCustomContent() entry to a dashboard row, or null when it is not
// an API document. Missing-id decision: id is entry.id, else value.id; with
// neither there is no stable key (and no content id to view/edit), so the row
// is dropped instead of getting a fresh Math.random() key on every reload.
export function toSpecDocument(entry: ICustomContent): AsyncApiDoc | null {
  const e = entry as any
  const v = e.value as (AsyncApiDoc & { diagramType?: string }) | undefined
  if (!v) return null
  // Dual-format: keep AsyncAPI ('async*' — the enum is 'AsyncAPI'; older builds
  // used 'AsyncApi'; a future one might use 'asyncapi') AND OpenAPI/Swagger
  // ('openapi'/'swagger'). Both are stored under the same async-api-doc
  // custom-content type, so searchCustomContent returns them together —
  // anything else (sequence/graph/embed) is dropped.
  const dt = typeof v.diagramType === 'string' ? v.diagramType.toLowerCase() : ''
  const isOpenApi = dt === 'openapi' || dt === 'swagger'
  if (!dt.startsWith('async') && !isOpenApi) return null
  const format: 'asyncapi' | 'openapi' = isOpenApi ? 'openapi' : 'asyncapi'

  const rawId = e.id ?? v.id
  if (rawId === undefined || rawId === null || rawId === '') return null
  const id = String(rawId)

  const parsed = parseSpecSummary(v.code)
  // Prefer the spec's `info.title` over the custom-content title.
  // The spec body is what the user actually edits in the Studio, so
  // info.title always reflects the latest user-entered name. The
  // custom-content title only updates if the editor's save flow
  // successfully writes it — and we've observed it lagging behind
  // when a doc is edited from the dashboard (the body code updates
  // but the top-level title doesn't). Reading from parsed.title
  // first means the card surfaces the user-chosen name immediately,
  // regardless of whether the title write race-loses.
  const title = parsed.title || e.title || v.title
    || (format === 'openapi' ? 'Untitled OpenAPI' : 'Untitled AsyncAPI')
  // Status precedence: the body's `status` field is the source of
  // truth for archived/trashed (Archive sets it via PUT — see the
  // dashboard's confirmDelete). Fall back to the v2 record's top-level
  // `status` only when the body doesn't carry one.
  const status = (v as any).status as string | undefined
    || e.status as string | undefined
  const createdAt = e.createdAt as string | undefined
  const updatedAt = (e.version && (e.version.createdAt as string)) || undefined
  const pageId = e.pageId ? String(e.pageId) : undefined
  const containerTitle = e.container?.title as string | undefined
  const containerLink = e.container?.link as string | undefined

  return {
    id,
    contentId: String(e.id ?? ''),
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
    rev: (e.version && (e.version.number as number)) || undefined,
    status,
    createdAt,
    updatedAt,
    createdLabel: formatTime(createdAt, 'Created'),
    updatedLabel: formatTime(updatedAt, 'Updated'),
    pageId,
    pageLabel: containerTitle || (pageId ? `Page ${pageId}` : undefined),
    pageUrl: containerLink,
  }
}
