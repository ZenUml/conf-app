import './assets/tailwind.css'
import { createApp, h } from 'vue'
import store from '@/model/store2'
import { getContext } from '@/model/globals/forgeGlobal'
import { tryPageEditorPaywall } from '@/utils/paywall/mountPaywallGate'
import { NULL_DIAGRAM } from '@/model/Diagram/Diagram'

// Counterpart to viewer-preview.html / viewerPreview.ts, but for the
// editor-modal boot path (src/forgeIndex.ts, tryPageEditorPaywall) rather
// than the page-viewer path (GenericViewer.vue). GenericViewer stopped
// owning the paywall modal once `openUpgradeModal` / `UpgradePromptRouter`
// were removed — the "Continue editing" gate now lives one iframe over, in
// the editor modal that Confluence opens after the viewer's Edit pencil is
// clicked. viewer-preview.html cannot reach that boot path, so this harness
// drives it directly: it calls the real `tryPageEditorPaywall` gate (the
// same function forgeIndex.ts calls in production) with a lightweight stub
// editor component, skipping the full forgeIndex boot (customContentId
// content fetch, orphan recovery, etc.) the same way viewerPreview.ts skips
// forgeIndex to mount GenericViewer directly.
const EditorContentStub = {
  render() {
    return h(
      'div',
      { class: 'p-8 text-gray-500 text-sm', 'data-testid': 'editor-content-stub' },
      'Editor preview — editor slot placeholder'
    )
  },
}

async function bootstrap() {
  const params = new URLSearchParams(location.search)
  if (!params.has('sandbox')) {
    const url = new URL(location.href)
    url.searchParams.set('sandbox', 'seq-edit')
    history.replaceState(null, '', url.toString())
  }

  // Mirrors viewerPreview.ts's mock knobs (read by useCustomerSuccessService,
  // the same singleton the real editor-modal boot uses) plus the two extra
  // ones tryPageEditorPaywall's continueAttemptsIdentity needs to resolve a
  // deterministic domain/space in standalone mode (getClientDomain() has no
  // real Confluence siteUrl to read here).
  const noBlock = params.get('noBlock') === '1'
  localStorage.mockCSSEnabled = 'true'
  localStorage.mockMacroCount = noBlock ? '60' : '120'
  localStorage.mockSpacePaid = 'false'
  localStorage.mockClientDomain = 'editor-preview-harness.atlassian.net'
  localStorage.mockSpaceKey = 'HARNESS'

  await getContext()

  // customContentId present ⟺ an edit (not a create) — see
  // isPageEditorEditBlocked in preEditGate.ts. Any non-empty id works; this
  // harness never fetches content for it.
  const blocked = await tryPageEditorPaywall({
    doc: NULL_DIAGRAM,
    content: EditorContentStub,
    contentProps: {},
    macroKind: 'sequence',
    customContentId: 'editor-preview-harness-custom-content-id',
  })

  // tryPageEditorPaywall only mounts (via mountRoot) when it fires. When the
  // space isn't saturated (noBlock=1) nothing has mounted yet, so mount the
  // stub editor directly — same as the unblocked path in forgeIndex.ts.
  if (!blocked) {
    createApp({ render: () => h(EditorContentStub) }).use(store).mount('#app')
  }
}

void bootstrap()
