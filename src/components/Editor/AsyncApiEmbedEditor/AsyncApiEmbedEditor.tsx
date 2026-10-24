// Document picker for the zenuml-asyncapi-embed-macro. Lists all
// AsyncAPI custom-content docs the user can see in the current space
// and submits the selected one's customContentId as the macro's config
// — the corresponding viewer entry (forge-asyncapi-viewer.ts) reads
// that id and renders the spec.
//
// Ported from AsyncAPI-Conf-V2's DocumentSelector.tsx + embed-editor
// page, simplified for the merged variant (uses globals.apWrapper
// instead of a private customContent service, and the host's
// js-yaml for spec parsing).

import React, { useEffect, useMemo, useState } from 'react'
import yaml from 'js-yaml'
import globals from '@/model/globals'
import type { ICustomContent } from '@/model/ICustomContent'

export interface AsyncApiEmbedPick {
  customContentId: string
  title: string
}

interface AsyncApiEmbedEditorProps {
  onSelect: (pick: AsyncApiEmbedPick) => void | Promise<void>
  onCancel?: () => void
}

interface DocRow {
  contentId: string
  title: string
  apiVersion?: string
  schemaVersion?: string
  description?: string
}

function parseDocTitle(code: string | undefined): {
  title?: string
  apiVersion?: string
  schemaVersion?: string
  description?: string
} {
  if (!code) return {}
  try {
    const doc = yaml.load(code) as Record<string, any> | null
    if (!doc || typeof doc !== 'object') return {}
    const info = (doc.info as Record<string, any>) || {}
    return {
      title: typeof info.title === 'string' ? info.title : undefined,
      apiVersion: typeof info.version === 'string' ? info.version : undefined,
      schemaVersion: typeof doc.asyncapi === 'string' ? doc.asyncapi : undefined,
      description: typeof info.description === 'string' ? info.description : undefined,
    }
  } catch {
    return {}
  }
}

const AsyncApiEmbedEditor: React.FC<AsyncApiEmbedEditorProps> = ({ onSelect, onCancel }) => {
  const [docs, setDocs] = useState<DocRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        await globals.apWrapper.initializeContext()
        const results: ICustomContent[] = await globals.apWrapper.searchCustomContent()
        if (cancelled) return
        const rows: DocRow[] = results
          .map((entry: any) => {
            const v = entry.value as { diagramType?: string; code?: string } | undefined
            if (!v) return null
            const dt = typeof v.diagramType === 'string' ? v.diagramType.toLowerCase() : ''
            if (!dt.startsWith('async')) return null
            const parsed = parseDocTitle(v.code)
            const contentId = String(entry.id ?? '')
            if (!contentId) return null
            return {
              contentId,
              // Prefer the spec's `info.title` over the custom-content
              // top-level title. The CC title lags behind on dashboard
              // edits (the body code updates but the title write
              // race-loses), so reading entry.title first surfaced a
              // stale name. Mirrors AsyncApiDashboard.vue's precedence.
              title: parsed.title || entry.title || 'Untitled AsyncAPI',
              apiVersion: parsed.apiVersion,
              schemaVersion: parsed.schemaVersion,
              description: parsed.description,
            }
          })
          .filter((d): d is DocRow => d !== null)
        setDocs(rows)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to load AsyncAPI documents'
        setError(msg)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const filteredDocs = useMemo(() => {
    const term = searchTerm.trim().toLowerCase()
    if (!term) return docs
    return docs.filter(
      (d) =>
        d.title.toLowerCase().includes(term) ||
        (d.description || '').toLowerCase().includes(term),
    )
  }, [docs, searchTerm])

  return (
    <div style={containerStyle}>
      <header style={headerStyle}>
        <div>
          <h2 style={titleStyle}>Embed an AsyncAPI document</h2>
          <p style={subtitleStyle}>
            Pick a document to embed. Saving this macro embeds a live reference —
            edits to the original document show up here automatically.
          </p>
        </div>
        {onCancel && (
          <button type="button" style={cancelBtnStyle} onClick={onCancel}>
            Cancel
          </button>
        )}
      </header>

      <input
        type="text"
        placeholder="Search documents…"
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        style={searchStyle}
      />

      {loading && <div style={stateStyle}>Loading AsyncAPI documents…</div>}

      {error && (
        <div style={errorStyle}>
          <strong>Failed to load documents.</strong>
          <p style={{ margin: '4px 0 0' }}>{error}</p>
        </div>
      )}

      {!loading && !error && filteredDocs.length === 0 && (
        <div style={stateStyle}>
          {docs.length === 0
            ? 'No AsyncAPI documents found in this site yet. Create one from the "My API Documents" space app first.'
            : 'No documents match your search.'}
        </div>
      )}

      <ul style={listStyle}>
        {filteredDocs.map((doc) => (
          <li key={doc.contentId} style={cardStyle}>
            <div>
              <h3 style={cardTitleStyle}>{doc.title}</h3>
              <div style={cardMetaStyle}>
                {doc.apiVersion && (
                  <span>
                    <strong>API:</strong> v{doc.apiVersion}
                  </span>
                )}
                {doc.schemaVersion && (
                  <span>
                    <strong>Schema:</strong> AsyncAPI {doc.schemaVersion}
                  </span>
                )}
                <span style={cardIdStyle}>ID: {doc.contentId}</span>
              </div>
              {doc.description && (
                <p style={cardDescStyle}>
                  {doc.description.length > 200 ? doc.description.slice(0, 200) + '…' : doc.description}
                </p>
              )}
            </div>
            <button
              type="button"
              style={selectBtnStyle}
              onClick={() => onSelect({ customContentId: doc.contentId, title: doc.title })}
            >
              Embed
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

const containerStyle: React.CSSProperties = {
  maxWidth: 880,
  margin: '0 auto',
  padding: 24,
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  color: '#172b4d',
}

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: 16,
  marginBottom: 16,
}

const titleStyle: React.CSSProperties = { margin: 0, fontSize: 22, color: '#0052cc' }
const subtitleStyle: React.CSSProperties = { margin: '6px 0 0', color: '#6b778c', fontSize: 13 }

const cancelBtnStyle: React.CSSProperties = {
  padding: '8px 16px',
  background: '#fff',
  border: '1px solid #dfe1e6',
  borderRadius: 4,
  color: '#42526e',
  cursor: 'pointer',
  fontSize: 14,
}

const searchStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  border: '1px solid #dfe1e6',
  borderRadius: 4,
  fontSize: 14,
  marginBottom: 16,
}

const listStyle: React.CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
}

const cardStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 16,
  background: '#fff',
  border: '1px solid #dfe1e6',
  borderRadius: 6,
  padding: 14,
  boxShadow: '0 1px 1px rgba(9, 30, 66, 0.04)',
}

const cardTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 15,
  color: '#0052cc',
  fontWeight: 600,
  wordBreak: 'break-word',
}

const cardMetaStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 12,
  marginTop: 6,
  fontSize: 12,
  color: '#5e6c84',
}

const cardIdStyle: React.CSSProperties = {
  fontFamily: '"SF Mono", Monaco, monospace',
}

const cardDescStyle: React.CSSProperties = {
  margin: '6px 0 0',
  fontSize: 13,
  color: '#42526e',
  lineHeight: 1.4,
}

const selectBtnStyle: React.CSSProperties = {
  padding: '8px 16px',
  background: '#0052cc',
  color: '#fff',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 14,
  fontWeight: 500,
  flexShrink: 0,
}

const stateStyle: React.CSSProperties = {
  textAlign: 'center',
  padding: '40px 20px',
  color: '#6b778c',
}

const errorStyle: React.CSSProperties = {
  background: '#ffebe6',
  border: '1px solid #ffbdad',
  color: '#de350b',
  borderRadius: 4,
  padding: 12,
  marginBottom: 12,
}

export default AsyncApiEmbedEditor
