import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { DIAGRAM_TYPE } from './macro-diagram-types.mjs';

// Stored documents use DiagramType's values (src/model/Diagram/Diagram.ts).
const enumSource = readFileSync(
  fileURLToPath(new URL('../../../../src/model/Diagram/Diagram.ts', import.meta.url)),
  'utf8',
);
const enumValue = (name) => new RegExp(`\\b${name}\\s*=\\s*'([^']+)'`).exec(enumSource)?.[1];

test('repro bodies use the same diagramType values as DiagramType', () => {
  assert.equal(DIAGRAM_TYPE.sequence, enumValue('Sequence'));
  assert.equal(DIAGRAM_TYPE.mermaid, enumValue('Mermaid'));
  assert.equal(DIAGRAM_TYPE.graph, enumValue('Graph'));
  assert.equal(DIAGRAM_TYPE.openapi, enumValue('OpenApi'));
  assert.equal(DIAGRAM_TYPE.openapi, 'OpenAPI');
});
