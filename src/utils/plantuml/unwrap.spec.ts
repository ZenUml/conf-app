import { describe, it, expect } from 'vitest';
import { selectServerBlock } from './unwrap';

// Expected blocks are what plantuml.com drew for the same synthetic shapes
// (measured 2026-10-24 with scripts/plantuml-compare, see ADR-0010).
describe('selectServerBlock (ADR-0010)', () => {
  const blankOutside = (code: string, from: number, to: number) =>
    code.split('\n').map((l, i) => (i >= from && i <= to ? l : '')).join('\n');

  it.each([
    ['a doubled header with one @enduml (the common production shape)', '@startuml\n@startuml\nAlice -> Bob\n@enduml', 1, 3],
    ['a doubled header and footer', '@startuml\n@startuml\nAlice -> Bob\n@enduml\n@enduml', 1, 3],
    ['@startuml around @startgantt', '@startuml\n@startgantt\n[x] lasts 1 day\n@endgantt\n@enduml', 1, 3],
    ['@startuml in front of @startjson, no outer @enduml', '@startuml\n@startjson\n{}\n@endjson', 1, 3],
    ['content before an inner block', '@startuml\nAlice -> Bob\n@startjson\n{}\n@endjson\n@enduml', 2, 4],
  ])('keeps the block the server draws for %s, line numbers unchanged', (_label, code, from, to) => {
    const { source, changed } = selectServerBlock(code);
    expect(changed).toBe(true);
    expect(selectServerBlock(code).multipleBlocks).toBe(false);
    expect(source).toBe(blankOutside(code, from, to));
    expect(source.split('\n')).toHaveLength(code.split('\n').length);
  });

  it.each([
    ['two separate blocks (the server merges them)', '@startuml\nA -> B\n@enduml\n@startuml\nC -> D\n@enduml'],
    ['two blocks with text between (the server reports an error)', '@startuml\nA -> B\n@enduml\nnotes\n@startuml\nC -> D\n@enduml'],
  ])('flags %s for the server and leaves the source alone', (_label, code) => {
    expect(selectServerBlock(code)).toEqual({ source: code, changed: false, multipleBlocks: true });
  });

  it('handles CRLF line endings', () => {
    const code = '@startuml\r\n@startuml\r\nA -> B\r\n@enduml\r\n';
    expect(selectServerBlock(code).source).toBe('\n@startuml\r\nA -> B\r\n@enduml\r\n');
  });

  it.each([
    ['an ordinary diagram', '@startuml\nAlice -> Bob\n@enduml'],
    ['an ordinary diagram with blank lines and a trailing newline', '\n@startuml\nAlice -> Bob\n@enduml\n'],
    ['a source with no @end line', '@startuml\n@startuml\nAlice -> Bob'],
    ['an empty source', ''],
  ])('leaves %s alone', (_label, code) => {
    expect(selectServerBlock(code)).toEqual({ source: code, changed: false, multipleBlocks: false });
  });
});
