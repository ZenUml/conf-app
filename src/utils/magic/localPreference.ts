import type { MagicArtifact } from '@/model/Diagram/Diagram';
import { magicSourceHash } from './artifact';

export interface MagicIdentity {
  accountId?: string | null;
  cloudId?: string | null;
  contentId?: string | null;
  sourceHash?: string | null;
}

const HASH = /^[a-f0-9]{64}$/;
const CHOICE_PREFIX = 'zenuml-magic-choice-v1';
const FEEDBACK_PREFIX = 'zenuml-magic-layout-feedback-v1';
export type MagicLayoutPreference = 'magic' | 'original' | 'no_preference';

/** An incomplete Forge identity must never create cross-user persistent state. */
export function magicPreferenceKey(identity: MagicIdentity): string | null {
  const { accountId, cloudId, contentId, sourceHash } = identity;
  if (!accountId || !cloudId || !contentId || !sourceHash || !HASH.test(sourceHash)) return null;
  return [CHOICE_PREFIX, accountId, cloudId, contentId, sourceHash].map(encodeURIComponent).join(':');
}

export function readMagicPreference(identity: MagicIdentity): 'magic' | 'original' | null {
  const key = magicPreferenceKey(identity);
  if (!key) return null;
  try {
    const value = localStorage.getItem(key);
    return value === 'magic' || value === 'original' ? value : null;
  } catch { return null; }
}

export function writeMagicPreference(identity: MagicIdentity, value: 'magic' | 'original'): boolean {
  const key = magicPreferenceKey(identity);
  if (!key) return false;
  try { localStorage.setItem(key, value); return true; }
  catch { return false; }
}

/** The same source may be regenerated; exact SVG bytes distinguish generations. */
export async function magicGenerationKey(artifact: MagicArtifact): Promise<string> {
  return magicSourceHash(`${artifact.rulesVersion}\0${artifact.generatedAt ?? ''}\0${artifact.svg}`);
}

export function magicFeedbackKey(identity: MagicIdentity, generation: string): string | null {
  const preference = magicPreferenceKey(identity);
  return preference && HASH.test(generation) ? `${FEEDBACK_PREFIX}:${preference}:${generation}` : null;
}

export function readMagicFeedback(identity: MagicIdentity, generation: string): MagicLayoutPreference | null {
  const key = magicFeedbackKey(identity, generation);
  if (!key) return null;
  try {
    const value = localStorage.getItem(key);
    return value === 'magic' || value === 'original' || value === 'no_preference' ? value : null;
  } catch { return null; }
}

export function writeMagicFeedback(identity: MagicIdentity, generation: string, preference: MagicLayoutPreference): boolean {
  const key = magicFeedbackKey(identity, generation);
  if (!key || !['magic', 'original', 'no_preference'].includes(preference)) return false;
  try { localStorage.setItem(key, preference); return true; }
  catch { return false; }
}
