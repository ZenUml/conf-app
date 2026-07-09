// Generator for the plain-text guide mirrors (guides/<key>.md).
//
// SINGLE SOURCE OF TRUTH: the guide text lives in the dialect .ts modules
// (zenumlDslGuide.ts / mermaidDslGuide.ts / plantumlDslGuide.ts) + the combined
// guide in dslGuides.ts, because the Cloudflare Pages Function bundle needs the
// text as a JS string (it cannot read files at runtime). These .md files are
// GENERATED mirrors so a plain Node script — specifically Track E1's offline
// eval in another repo — can read a guide by file path with NO build step.
//
// Regenerate after editing any guide:
//   npx tsx functions/agent-link/guides/generate-guides.ts
//
// guides.spec.ts asserts each .md byte-matches its .ts constant, so drift fails
// CI — the .ts stays authoritative and the .md can never silently diverge.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getGuideText, GUIDE_KEYS } from '../dslGuides';

const here = dirname(fileURLToPath(import.meta.url));

for (const key of GUIDE_KEYS) {
  const path = join(here, `${key}.md`);
  writeFileSync(path, getGuideText(key), 'utf8');
  // eslint-disable-next-line no-console
  console.log(`wrote ${path} (${getGuideText(key).length} chars)`);
}
