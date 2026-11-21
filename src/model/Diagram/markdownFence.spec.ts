import { describe, it, expect } from 'vitest';
import { stripMarkdownFence } from '@/model/Diagram/markdownFence';

const BODY = `sequenceDiagram
  autonumber
  participant R as Robot
  participant GW as Gateway<br/>(edge)
  R->>GW: request credential
  alt ok
    GW-->>R: credential
  end`;
const FENCED = '```mermaid\n' + BODY + '\n```';

describe('stripMarkdownFence', () => {
  it('returns text without a fence unchanged', () => {
    const r = stripMarkdownFence(BODY);
    expect(r.text).toBe(BODY);
    expect(r.fenced).toBe(false);
    expect(r.language).toBe('none');
  });

  it('removes a mermaid fence', () => {
    expect(stripMarkdownFence(FENCED)).toEqual({ text: BODY, fenced: true, language: 'mermaid' });
  });

  it('removes a fence without an info string', () => {
    expect(stripMarkdownFence('```\n' + BODY + '\n```')).toEqual({ text: BODY, fenced: true, language: 'none' });
  });

  it('classifies plantuml fences', () => {
    expect(stripMarkdownFence('```plantuml\n@startuml\nA -> B: hi\n@enduml\n```')).toEqual({
      text: '@startuml\nA -> B: hi\n@enduml',
      fenced: true,
      language: 'plantuml',
    });
  });

  it('classifies other languages as other', () => {
    expect(stripMarkdownFence('```js\nconst a = 1\n```')).toEqual({ text: 'const a = 1', fenced: true, language: 'other' });
  });

  it('drops prose before and after the fence', () => {
    expect(stripMarkdownFence('Here is the diagram:\n' + FENCED + '\nHope this helps').text).toBe(BODY);
  });

  it('keeps only the first block when several exist', () => {
    const r = stripMarkdownFence(FENCED + '\n\n```mermaid\nflowchart LR\n  A-->B\n```');
    expect(r).toEqual({ text: BODY, fenced: true, language: 'mermaid' });
  });

  it('handles CRLF line endings', () => {
    expect(stripMarkdownFence(FENCED.replace(/\n/g, '\r\n'))).toEqual({ text: BODY, fenced: true, language: 'mermaid' });
  });

  it('handles blank lines around the fence', () => {
    expect(stripMarkdownFence('\n\n' + FENCED + '\n').text).toBe(BODY);
  });

  it('drops a leading opener that has no closer', () => {
    expect(stripMarkdownFence('```mermaid\n' + BODY)).toEqual({ text: BODY, fenced: true, language: 'mermaid' });
  });

  it('drops a lone closing fence at the end', () => {
    expect(stripMarkdownFence(BODY + '\n```')).toEqual({ text: BODY, fenced: true, language: 'none' });
  });

  it('leaves a lone fence line in the middle unchanged', () => {
    const input = 'A->B: one\n```\nB->C: two';
    expect(stripMarkdownFence(input)).toEqual({ text: input, fenced: false, language: 'none' });
  });

  it('accepts longer backtick fences', () => {
    expect(stripMarkdownFence('````mermaid\n' + BODY + '\n````')).toEqual({ text: BODY, fenced: true, language: 'mermaid' });
  });

  it('accepts a braced info string', () => {
    expect(stripMarkdownFence('```{mermaid}\n' + BODY + '\n```')).toEqual({ text: BODY, fenced: true, language: 'mermaid' });
  });

  it('does not treat inline backticks as a fence', () => {
    const input = 'flowchart LR\n  A["`**bold** text`"] --> B';
    expect(stripMarkdownFence(input)).toEqual({ text: input, fenced: false, language: 'none' });
  });

  it('keeps inner indentation of an indented fence', () => {
    expect(stripMarkdownFence('  ```mermaid\n  flowchart LR\n    A-->B\n  ```')).toEqual({
      text: '  flowchart LR\n    A-->B',
      fenced: true,
      language: 'mermaid',
    });
  });
});
