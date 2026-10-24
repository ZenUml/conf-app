import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchPreparedDiagram,
  preparedToDiagram,
  preparedAgeDays,
} from './ActivationPrepared';
import { DiagramType } from '@/model/Diagram/Diagram';

vi.mock('@/utils/requestUtil', () => ({ callRemote: vi.fn() }));
import { callRemote } from '@/utils/requestUtil';

describe('ActivationPrepared', () => {
  describe('fetchPreparedDiagram', () => {
    it('returns the payload on a hit', async () => {
      (callRemote as any).mockResolvedValueOnce({
        diagramType: 'mermaid', diagramSource: 'graph TD; A-->B', title: 'Flow', curatedAt: '2026-07-20T00:00:00Z',
      });
      const r = await fetchPreparedDiagram('123');
      expect(r?.diagramType).toBe('mermaid');
      expect((callRemote as any).mock.calls[0][0]).toBe('/activation-prepared?pageId=123');
    });

    it('maps a 404 (thrown by callRemote) to undefined → cache miss', async () => {
      (callRemote as any).mockRejectedValueOnce(new Error('HTTP 404: not found'));
      expect(await fetchPreparedDiagram('123')).toBeUndefined();
    });

    it('rethrows a non-404 error (real failure, not a miss)', async () => {
      (callRemote as any).mockRejectedValueOnce(new Error('HTTP 500: boom'));
      await expect(fetchPreparedDiagram('123')).rejects.toThrow('HTTP 500');
    });

    it('treats a malformed payload (missing fields) as a miss', async () => {
      (callRemote as any).mockResolvedValueOnce({ title: 'no source' });
      expect(await fetchPreparedDiagram('123')).toBeUndefined();
    });
  });

  describe('preparedToDiagram — routes source into the type-matching field ONLY', () => {
    it.each([
      ['mermaid', DiagramType.Mermaid, 'mermaidCode'],
      ['sequence', DiagramType.Sequence, 'code'],
      ['plantuml', DiagramType.PlantUml, 'plantUmlCode'],
      ['graph', DiagramType.Graph, 'graphXml'],
    ])('%s → %s field', (type, expectedType, field) => {
      const d: any = preparedToDiagram({ diagramType: type, diagramSource: 'SRC', title: 'T' });
      expect(d.diagramType).toBe(expectedType);
      expect(d[field]).toBe('SRC');
      // The other content fields must stay empty (schema-traps: a stray value in
      // a non-matching field is mis-read by later per-type queries).
      for (const f of ['code', 'mermaidCode', 'plantUmlCode', 'graphXml']) {
        if (f !== field) expect(d[f] || '').toBe('');
      }
    });

    it('sets NO id (an id forces the update branch against a non-existent record)', () => {
      const d = preparedToDiagram({ diagramType: 'mermaid', diagramSource: 'x', title: 'T' });
      expect(d.id).toBeUndefined();
      expect(d.isNew).toBe(true);
    });
  });

  describe('preparedAgeDays', () => {
    beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-07-26T00:00:00Z')); });
    afterEach(() => vi.useRealTimers());
    it('computes whole days since curation', () => {
      expect(preparedAgeDays({ diagramType: 'mermaid', diagramSource: 'x', curatedAt: '2026-07-20T00:00:00Z' })).toBe(6);
    });
    it('is undefined with no/invalid timestamp', () => {
      expect(preparedAgeDays({ diagramType: 'mermaid', diagramSource: 'x' })).toBeUndefined();
      expect(preparedAgeDays({ diagramType: 'mermaid', diagramSource: 'x', curatedAt: 'nope' })).toBeUndefined();
    });
  });
});
