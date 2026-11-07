/**
 * MCP promo in the macro editor (Workspace.vue). Two placements, one state:
 *
 * - 'editor_new_diagram': a card over the preview while a new diagram still
 *   shows the starter code it opened with. It goes away (not dismissed) as
 *   soon as the author edits the code.
 * - 'editor_tip': a tip docked in the code pane once the author has typed a
 *   lot by hand in this editor session — TIP_TYPED_CHARS characters, or
 *   TIP_MIN_EDITS edits spread over TIP_EDIT_MS.
 *
 * Both open ConnectMcpDialog. Shared frequency rules (session cap, dismissal,
 * engagement) come from mcpPromo.ts, so a dismissal in Fullscreen also hides
 * these, and the reverse.
 */
import { computed, onMounted, reactive, ref, watch, type Ref } from 'vue'
import { DiagramType } from '@/model/Diagram/Diagram'
import { isAgentLinkEnabled } from '@/apis/aiTitleFeatureFlag'
import { getContext } from '@/model/globals/forgeGlobal'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'
import type { AgentLinkMcpButtonPlacement, AgentLinkMcpCopyTarget } from '@/utils/analytics/catalog'
import { createMcpPromoState, type McpPromoState } from './mcpPromo'
import { createConnectMcpShownRecord } from './connectMcpShown'
import { buildEditorDraftPrompt } from './connectInstructions'

export const TIP_TYPED_CHARS = 400
export const TIP_MIN_EDITS = 10
export const TIP_EDIT_MS = 3 * 60_000

// Same scope as the viewer's Connect MCP: agent-native DSL types only.
const SUPPORTED: readonly string[] = [DiagramType.Sequence, DiagramType.Mermaid, DiagramType.PlantUml]

const DIALECT: Record<string, string> = {
  [DiagramType.Sequence]: 'ZenUML sequence',
  [DiagramType.Mermaid]: 'Mermaid',
  [DiagramType.PlantUml]: 'PlantUML',
}

type PromoPlacement = Extract<AgentLinkMcpButtonPlacement, 'editor_new_diagram' | 'editor_tip'>

export function useEditorMcpPromo(options: {
  diagramType: Ref<string | undefined>
  code: Ref<string>
  diagramId: Ref<string | undefined>
  now?: () => number
}) {
  const now = options.now ?? Date.now
  const enabled = ref(false)
  const hidden = ref(false)
  // Reactive: it is filled after mount, while the dialog's props (target and
  // prompt) are computed from it at first render.
  const scope = reactive({ cloudId: '', accountId: '', pageId: '' })
  let promoState: McpPromoState | null = null

  // Captured at mount: what "untouched" means for a new diagram.
  const isNewDiagram = !options.diagramId.value
  const startingCode = options.code.value ?? ''

  // Manual-typing measurement for the tip.
  const editCount = ref(0)
  const typedChars = ref(0)
  let firstEditAt = 0
  const tipTriggered = ref(false)

  const supported = computed(() => SUPPORTED.includes(options.diagramType.value ?? ''))
  const untouched = computed(() => (options.code.value ?? '') === startingCode)

  const showNewDiagramCard = computed(() =>
    enabled.value && supported.value && !hidden.value && isNewDiagram && untouched.value)
  const showTip = computed(() =>
    enabled.value && supported.value && !hidden.value && tipTriggered.value && !showNewDiagramCard.value)

  watch(options.code, (next, prev) => {
    if (prev === undefined || tipTriggered.value) return
    const delta = Math.max(1, Math.abs((next ?? '').length - (prev ?? '').length))
    // A paste or an applied AI change replaces a block at once; it is not
    // the sustained hand typing the tip is about.
    if (delta > 80) return
    editCount.value += 1
    typedChars.value += delta
    if (!firstEditAt) firstEditAt = now()
    if (typedChars.value >= TIP_TYPED_CHARS
      || (editCount.value >= TIP_MIN_EDITS && now() - firstEditAt >= TIP_EDIT_MS)) {
      tipTriggered.value = true
    }
  })

  function analytics(extra: Record<string, unknown> = {}) {
    return {
      feature_area: 'agent_link' as const,
      surface: 'editor' as const,
      macro_type: options.diagramType.value || 'none',
      mcp_mode: 'headless' as const,
      ...extra,
    }
  }

  const shownTracked = new Set<PromoPlacement>()
  function trackShown(placement: PromoPlacement) {
    if (shownTracked.has(placement)) return
    shownTracked.add(placement)
    promoState?.recordShown()
    const record = createConnectMcpShownRecord({ cloudId: scope.cloudId, accountId: scope.accountId, placement })
    if (!record.recordShown()) return
    trackAnalyticsEvent('agent_link_mcp_button_shown', analytics({
      mcp_button_placement: placement,
      mcp_button_reveal: 'always',
    }))
  }
  watch(showNewDiagramCard, (v) => { if (v) trackShown('editor_new_diagram') })
  watch(showTip, (v) => { if (v) trackShown('editor_tip') })

  // Dialog.
  const dialogVisible = ref(false)
  const dialogPlacement = ref<PromoPlacement>('editor_tip')
  let openedAt = 0

  const dialogTarget = computed(() => ({
    cloudId: scope.cloudId,
    pageId: scope.pageId,
    contentId: options.diagramId.value ?? '',
  }))
  // A saved diagram gets the viewer's "review this diagram" prompt (the
  // dialog's default); a new one gets the draft-and-paste prompt.
  const dialogPrompt = computed(() => (options.diagramId.value
    ? ''
    : buildEditorDraftPrompt({
      cloudId: scope.cloudId,
      pageId: scope.pageId,
      dialect: DIALECT[options.diagramType.value ?? ''] ?? 'ZenUML',
    })))

  function onCta(placement: PromoPlacement) {
    hidden.value = true
    dialogPlacement.value = placement
    dialogVisible.value = true
    openedAt = now()
    trackAnalyticsEvent('agent_link_mcp_dialog_opened', analytics({
      mcp_button_placement: placement,
      mcp_button_reveal: 'always',
    }))
  }

  function onDismiss(placement: PromoPlacement) {
    hidden.value = true
    promoState?.dismiss()
    trackAnalyticsEvent('agent_link_mcp_promo_dismissed', analytics({ mcp_button_placement: placement }))
  }

  function closeDialog() {
    if (!dialogVisible.value) return
    dialogVisible.value = false
    trackAnalyticsEvent('agent_link_mcp_dialog_closed', analytics({
      mcp_button_placement: dialogPlacement.value,
      dwell_ms: now() - openedAt,
    }))
  }

  function onCopied(target: AgentLinkMcpCopyTarget, ok: boolean) {
    if (ok) promoState?.markEngaged()
    trackAnalyticsEvent('agent_link_mcp_dialog_copied', analytics({
      mcp_button_placement: dialogPlacement.value,
      mcp_copy_target: target,
      outcome: ok ? 'copied' : 'clipboard_failed',
    }))
  }

  onMounted(async () => {
    if (!supported.value) return
    try {
      const ctx: any = await getContext()
      scope.cloudId = ctx?.cloudId ?? ''
      scope.accountId = ctx?.accountId ?? ''
    } catch {
      // Without an identity the promo still works; it keys to '-'.
    }
    const forgeCtx = (window as any).forgeGlobal?.forgeContext
    scope.cloudId = scope.cloudId || forgeCtx?.cloudId || ''
    scope.pageId = String(forgeCtx?.extension?.content?.id ?? '')
    let flag = false
    try {
      flag = await isAgentLinkEnabled()
    } catch {
      flag = false
    }
    if (!flag) return
    promoState = createMcpPromoState({ cloudId: scope.cloudId, accountId: scope.accountId })
    enabled.value = promoState.canShow()
  })

  return {
    showNewDiagramCard,
    showTip,
    onCta,
    onDismiss,
    dialogVisible,
    dialogTarget,
    dialogPrompt,
    closeDialog,
    onCopied,
  }
}
