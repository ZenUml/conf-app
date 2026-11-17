import type { PasteFenceLanguage } from '@/utils/analytics/catalog';

export interface FenceStripResult { text: string; fenced: boolean; language: PasteFenceLanguage }

export function stripMarkdownFence(_text: string): FenceStripResult {
  throw new Error('not implemented');
}
