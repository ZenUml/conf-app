// Product vocabulary comes from the root document, including conditional wiring.
// This module runs in Node tooling only; it does not establish UI verification.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';

const ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
export const scenarioKey = pair => `${pair.feature}:${pair.interface}`;
export const scenarioTag = pair => `@scenario:${scenarioKey(pair)}`;

export function parseProductImpact(markdown) {
  const interfaces = [...markdown.matchAll(/^\| ([A-Z]+) \| `([^`]+)` — /gm)];
  const interfaceIds = interfaces.map(m => m[2]);
  if (!interfaces.length || new Set(interfaceIds).size !== interfaces.length
      || new Set(interfaces.map(m => m[1])).size !== interfaces.length
      || interfaceIds.some(id => !ID.test(id))) throw new Error('Invalid impact-map interface registry');
  const features = [], scenarios = [];
  const contracts = markdown.split(/^### F\d+ · /m).slice(1);
  for (const contract of contracts) {
    const feature = contract.split('\n')[0].match(/ — `([^`]+)`$/)?.[1];
    const relations = contract.match(/^\*\*交互面\*\*：([^\n]+)$/m)?.[1];
    if (!feature || !ID.test(feature) || features.includes(feature) || !relations) throw new Error('Invalid impact-map feature contract');
    features.push(feature);
    const pairs = [...relations.matchAll(/`([^`]+)` ([●↗GAB])/g)].map(m => ({ feature, interface: m[1] }));
    if (!pairs.length || pairs.some(pair => !interfaceIds.includes(pair.interface))
        || new Set(pairs.map(scenarioKey)).size !== pairs.length) throw new Error(`Invalid impact-map relations: ${feature}`);
    scenarios.push(...pairs);
  }
  if (!features.length) throw new Error('Empty impact map');
  // Both human views must agree before the map can authorize selection.
  const byCode = new Map(interfaces.map(m => [m[1], m[2]]));
  const byNumber = new Map([...markdown.matchAll(/^### F(\d+) · .* — `([^`]+)`$/gm)].map(m => [Number(m[1]), m[2]]));
  const matrix = [];
  let headers = null;
  for (const line of markdown.split('\n')) {
    if (line.startsWith('| Feature |')) {
      headers = line.split('|').slice(2, -1).map(cell => {
        const match = /^([A-Z]+) • ([a-z0-9-]+)$/.exec(cell.trim());
        if (!match || byCode.get(match[1]) !== match[2]) throw new Error('Invalid impact-map matrix header');
        return match[2];
      });
    } else if (/^\| \[F\d+ /.test(line)) {
      const cells = line.split('|').slice(1, -1).map(c => c.trim());
      const feature = byNumber.get(Number(cells[0].match(/^\[F(\d+)/)[1]));
      if (!headers || !feature || cells.length !== headers.length + 1) throw new Error('Invalid impact-map matrix row');
      cells.slice(1).forEach((cell, i) => {
        if (cell === '·') return;
        if (!['●', '↗', 'G', 'A', 'B'].includes(cell)) throw new Error('Invalid impact-map matrix cell');
        matrix.push(scenarioKey({feature, interface: headers[i]}));
      });
    }
  }
  if (new Set(matrix).size !== matrix.length || JSON.stringify(matrix.sort()) !== JSON.stringify(scenarios.map(scenarioKey).sort())) throw new Error('Impact-map matrix/contracts disagree');
  return { features: features.sort(), interfaces: interfaceIds.sort(), scenarios: scenarios.sort((a,b) => scenarioKey(a).localeCompare(scenarioKey(b))) };
}

// Vitest's jsdom transform gives modules an HTTP URL; its working directory
// is the repository root. Normal CLI/Playwright use resolves beside this module.
const documentPath = import.meta.url.startsWith('file:')
  ? resolve(dirname(fileURLToPath(import.meta.url)), '../../../IMPACT-MAP.md')
  : resolve(process.cwd(), 'IMPACT-MAP.md');
const document = readFileSync(documentPath, 'utf8');
const parsed = parseProductImpact(document);
export const FEATURES = parsed.features;
export const INTERFACES = parsed.interfaces;
export const SCENARIOS = parsed.scenarios;
// Include applicability/evidence edits too, not only the nonempty cells.
export const PRODUCT_IMPACT_FINGERPRINT = createHash('sha256').update(document).digest('hex');
const known = new Set(SCENARIOS.map(scenarioKey));
export function validScenarios(value) {
  return Array.isArray(value) && value.every(pair => pair && typeof pair === 'object' && !Array.isArray(pair)
    && Object.keys(pair).length === 2 && typeof pair.feature === 'string' && typeof pair.interface === 'string'
    && known.has(scenarioKey(pair))) && new Set(value.map(scenarioKey)).size === value.length;
}
