import { titleDraftCopyProps, type TitleDraftCopyExposure } from './copyExperiment'

/** Shared Mixpanel properties. The title and the diagram source are never sent. */
export function titleDraftProps(kind?: string, confidence?: number, exposure?: TitleDraftCopyExposure) {
  return {
    feature_area: 'title_draft' as const,
    surface: 'page_banner' as const,
    macro_type: 'mermaid' as const,
    ...titleDraftCopyProps(exposure),
    ...(kind ? { title_draft_kind: kind } : {}),
    ...(typeof confidence === 'number' ? { title_draft_confidence: confidence } : {}),
  }
}
