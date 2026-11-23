import fs from 'node:fs';
import { createRequire } from 'node:module';
const root = process.argv[2];
const req = createRequire(root + '/package.json');
const oldY = req(root + '/node_modules/.pnpm/js-yaml@4.1.1/node_modules/js-yaml');
const newY = req(root + '/node_modules/.pnpm/js-yaml@4.3.2/node_modules/js-yaml');
console.log('old', oldY === newY ? 'SAME?!' : 'distinct');
const grab = (file, name) => {
  const src = fs.readFileSync(root + '/' + file, 'utf8');
  const i = src.indexOf(name + ' = `'); const s = i + name.length + 4;
  return src.slice(s, src.indexOf('`', s));
};
const extra = `openapi: 3.0.3
info:
  title: "Edge: cases"
  description: |
    Multi-line
    block with 'quotes' and "double" and: colons
  version: '1.0'
x-date: 2024-01-02
x-bool-str: 'yes'
x-num-str: '0123'
x-null: ~
x-anchor: &a {k: v}
x-ref: *a
x-long: ${'word '.repeat(40)}
x-unicode: "中文 ✓ \\u00e9"
paths:
  /p/{id}:
    get:
      parameters:
        - {name: id, in: path, required: true, schema: {type: string, pattern: '^[a-z]+$'}}
      responses:
        '200': {description: ok}
`;
const cases = {
  openapi_demo: grab('src/demoPageContent.js', 'OPENAPI_BODY'),
  asyncapi_default: grab('src/forge-asyncapi-editor.ts', 'DEFAULT_ASYNCAPI_SPEC'),
  edge: extra,
};
let diffs = 0;
for (const [k, text] of Object.entries(cases)) {
  const a = oldY.load(text), b = newY.load(text);
  const loadEq = JSON.stringify(a) === JSON.stringify(b);
  const dA = oldY.dump(a), dB = newY.dump(b);
  const all = []; oldY.loadAll(text, d => all.push(d)); const all2 = []; newY.loadAll(text, d => all2.push(d));
  const ok = loadEq && dA === dB && JSON.stringify(all) === JSON.stringify(all2);
  if (!ok) diffs++;
  console.log(k, 'bytes', text.length, 'load equal', loadEq, 'dump equal', dA === dB, 'loadAll equal', JSON.stringify(all) === JSON.stringify(all2));
  if (dA !== dB) { console.log('--- old dump\n' + dA + '\n--- new dump\n' + dB); }
}
process.exit(diffs ? 1 : 0);
