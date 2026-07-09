import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getGuideText, GUIDE_KEYS } from '../dslGuides';

// Drift guard for the plain-text mirrors (guides/<key>.md). The .ts constants
// are the single source of truth (the Worker bundle needs them as JS strings);
// these .md files exist so Track E1's offline eval can read a guide by file
// path without a build step. If they ever diverge from the .ts, this fails —
// run `npx tsx functions/agent-link/guides/generate-guides.ts` to regenerate.
describe('guides/*.md mirrors stay in sync with the .ts source of truth', () => {
  for (const key of GUIDE_KEYS) {
    it(`${key}.md byte-matches getGuideText('${key}')`, () => {
      const onDisk = readFileSync(join(__dirname, `${key}.md`), 'utf8');
      expect(onDisk).toBe(getGuideText(key));
    });
  }
});
