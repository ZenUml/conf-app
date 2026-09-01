import type { AppKey } from '@/data/types'

/**
 * Chip tones. The product four and the status seven are the only chips in the
 * design; `Chip.vue` owns their colours so no component re-derives them.
 */
export type ChipTone =
  | AppKey
  | 'grant'
  | 'expiry'
  | 'ingest'
  | 'skipped'
  | 'blocked'
  | 'failed'
  | 'lapsed'
  | 'retrying'
  | 'pending'
  | 'sent'

export interface ProductAccent {
  /** The name the ingest uses, which is also what the chip reads. */
  name: string
  /** Dot / left-bar colour. */
  color: string
  chip: ChipTone
}

/** ADDON_APP_MAP's four values. */
export const PRODUCT: Record<AppKey, ProductAccent> = {
  full: { name: 'full', color: 'var(--product-full)', chip: 'full' },
  lite: { name: 'lite', color: 'var(--product-lite)', chip: 'lite' },
  dia: { name: 'diagramly', color: 'var(--product-diagramly)', chip: 'dia' },
  api: { name: 'asyncapi', color: 'var(--accent-openapi-500)', chip: 'api' }
}

/** Left-bar / dot colour for the five `activatedBy` buckets. */
export const ORIGIN_ACCENT = {
  brand: 'var(--color-primary)',
  cerulean: 'var(--accent-sequence-500)',
  radical: 'var(--accent-mermaid-500)',
  leaf: 'var(--accent-openapi-500)',
  rust: 'var(--accent-plantuml-500)'
} as const

/** Automation-rule tone → left bar colour and chip. */
export const RULE_TONE = {
  good: { bar: 'var(--color-success)', chip: 'sent' as ChipTone },
  warn: { bar: 'var(--accent-sequence-500)', chip: 'blocked' as ChipTone },
  bad: { bar: 'var(--accent-plantuml-500)', chip: 'failed' as ChipTone }
} as const
