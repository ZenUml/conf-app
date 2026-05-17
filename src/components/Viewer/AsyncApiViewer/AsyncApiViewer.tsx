// Read-only AsyncAPI viewer. Ported from AsyncAPI-Conf-V2's AsyncAPIViewer
// but stripped of the source app's analytics machinery — host has its own
// tracking layer and PR #3 keeps event wiring deferred to a follow-up.

import React, { useMemo } from 'react'
import AsyncAPIReactComponent from '@asyncapi/react-component'
import yaml from 'js-yaml'
import '@asyncapi/react-component/styles/default.min.css'

interface AsyncApiViewerProps {
  spec: string | undefined
  /**
   * Optional callback fired when the user clicks "Edit" in the viewer
   * overlay. The entry point wires this to view.submit({ action: 'edit' })
   * when the viewer is rendered inside a modal opened from the dashboard.
   * Undefined (no button rendered) when the viewer renders inline on a
   * Confluence page (no edit affordance there — that's the macro's
   * edit-in-place flow).
   */
  onEdit?: () => void
}

function parseSpec(raw: string): unknown {
  // AsyncAPI specs may arrive as YAML or JSON. js-yaml's load() handles both
  // (JSON is a subset of YAML) so a single parse path is enough.
  return yaml.load(raw)
}

const ERROR_STYLE: React.CSSProperties = {
  border: '1px solid #DE350B',
  borderRadius: 4,
  backgroundColor: '#FFEBE6',
  color: '#DE350B',
  padding: 16,
  margin: 16,
}

const EMPTY_STYLE: React.CSSProperties = {
  padding: 20,
  textAlign: 'center',
  color: '#666',
  minHeight: 200,
}

const EDIT_BUTTON_STYLE: React.CSSProperties = {
  position: 'fixed',
  top: 16,
  right: 16,
  zIndex: 1000,
  padding: '8px 18px',
  border: 'none',
  borderRadius: 4,
  background: '#0052cc',
  color: 'white',
  cursor: 'pointer',
  fontSize: 14,
  fontWeight: 500,
  boxShadow: '0 2px 6px rgba(0, 0, 0, 0.2)',
}

const AsyncApiViewer: React.FC<AsyncApiViewerProps> = ({ spec, onEdit }) => {
  const { parsed, error } = useMemo(() => {
    if (!spec || spec.trim().length === 0) {
      return { parsed: null, error: null as string | null }
    }
    try {
      const result = parseSpec(spec)
      if (!result || typeof result !== 'object') {
        return { parsed: null, error: 'AsyncAPI spec did not parse to an object.' }
      }
      return { parsed: result, error: null }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown parse error'
      return { parsed: null, error: 'Failed to parse AsyncAPI spec: ' + msg }
    }
  }, [spec])

  if (!spec || spec.trim().length === 0) {
    return (
      <div style={EMPTY_STYLE}>
        <h3 style={{ margin: 0 }}>No AsyncAPI specification</h3>
        <p style={{ margin: '8px 0 0' }}>This macro has no saved spec yet.</p>
      </div>
    )
  }

  if (error) {
    return (
      <div style={ERROR_STYLE}>
        <h3 style={{ margin: 0 }}>Error rendering AsyncAPI</h3>
        <p style={{ margin: '8px 0 0' }}>{error}</p>
        <details style={{ marginTop: 12 }}>
          <summary>Raw spec</summary>
          <pre style={{
            background: '#f4f5f7', padding: 10, borderRadius: 4,
            overflow: 'auto', maxHeight: 200, fontSize: 12, margin: '8px 0 0',
          }}>
            {spec}
          </pre>
        </details>
      </div>
    )
  }

  return (
    <div style={{ width: '100%' }}>
      {onEdit && (
        <button
          type="button"
          style={EDIT_BUTTON_STYLE}
          onClick={onEdit}
          title="Edit this AsyncAPI document"
        >
          ✎ Edit
        </button>
      )}
      <AsyncAPIReactComponent
        schema={parsed as object}
        config={{
          show: {
            info: true,
            servers: true,
            operations: true,
            messages: true,
            schemas: true,
          },
          expand: { messageExamples: false },
          sidebar: { showOperations: 'byDefault' },
        }}
      />
    </div>
  )
}

export default AsyncApiViewer
