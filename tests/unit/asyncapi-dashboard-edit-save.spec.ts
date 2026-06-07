import { describe, it, expect, vi } from 'vitest';
import { buildAsyncApiSaveDiagram } from '@/model/asyncapi/buildSaveDiagram';
import { CustomContentStorageProvider } from '@/model/ContentProvider/CustomContentStorageProvider';
import { DataSource, DiagramType, type Diagram } from '@/model/Diagram/Diagram';

// Regression: editing an AsyncAPI document from the dashboard created a NEW
// document instead of updating it. Root cause: ApWrapper2.getCustomContentByIdV2
// runs cross-page-copy detection that false-positives on dashboard loads (the
// dashboard space page is never the content's origin page), stamping
// isCopy=true. CustomContentStorageProvider.save then refuses to update
// (requires !isCopy) and CREATES a copy. The fix pins the dashboard save to
// the known id and clears isCopy via buildAsyncApiSaveDiagram({ pinToId }).

function mockApWrapper() {
  return {
    saveCustomContentV2: vi.fn(async (id: string, _d: Diagram) => ({ id })),
    createCustomContentV2: vi.fn(async (_d: Diagram) => ({ id: 'newly-created-id' })),
  } as any;
}

const loadedDashboardDoc = (): Diagram =>
  ({
    id: '682262581',
    source: DataSource.CustomContent,
    isCopy: true, // false-positive stamped by the loader on a dashboard load
    copyReason: 'cross-page',
    diagramType: DiagramType.AsyncApi,
    code: 'asyncapi: 3.0.0\n# old',
  }) as Diagram;

describe('buildAsyncApiSaveDiagram', () => {
  it('pins the id and clears the false-positive isCopy for a dashboard edit', () => {
    const diagram = buildAsyncApiSaveDiagram({
      existing: loadedDashboardDoc(),
      spec: 'asyncapi: 3.0.0\n# new',
      title: 'My API',
      pinToId: '682262581',
    });
    expect(diagram.id).toBe('682262581');
    expect(diagram.isCopy).toBe(false);
    expect(diagram.source).toBe(DataSource.CustomContent);
    expect(diagram.diagramType).toBe(DiagramType.AsyncApi);
    expect(diagram.code).toBe('asyncapi: 3.0.0\n# new');
    expect(diagram.title).toBe('My API');
  });

  it('preserves the loaded copy state when not a dashboard edit (no pinToId)', () => {
    const diagram = buildAsyncApiSaveDiagram({
      existing: { id: 'abc', source: DataSource.CustomContent, isCopy: true, diagramType: DiagramType.AsyncApi } as Diagram,
      spec: 'spec',
    });
    expect(diagram.id).toBe('abc');
    expect(diagram.isCopy).toBe(true); // copy-aware path unchanged
  });

  it('produces no id for a brand-new document', () => {
    const diagram = buildAsyncApiSaveDiagram({ spec: 'spec' });
    expect(diagram.id).toBeUndefined();
    expect(diagram.source).toBe(DataSource.CustomContent);
  });
});

describe('AsyncAPI dashboard edit routes save to UPDATE, not create', () => {
  it('dashboard edit (pinned) → saveCustomContentV2 (update in place)', async () => {
    const ap = mockApWrapper();
    const diagram = buildAsyncApiSaveDiagram({
      existing: loadedDashboardDoc(),
      spec: 'new',
      pinToId: '682262581',
    });
    await new CustomContentStorageProvider(ap).save(diagram);
    expect(ap.saveCustomContentV2).toHaveBeenCalledWith('682262581', diagram);
    expect(ap.createCustomContentV2).not.toHaveBeenCalled();
  });

  it('documents the original bug: false-positive isCopy with no pin → createCustomContentV2', async () => {
    const ap = mockApWrapper();
    await new CustomContentStorageProvider(ap).save(loadedDashboardDoc());
    expect(ap.createCustomContentV2).toHaveBeenCalled();
    expect(ap.saveCustomContentV2).not.toHaveBeenCalled();
  });

  it('macro edit (not a copy, no pin) still updates in place', async () => {
    const ap = mockApWrapper();
    const diagram = buildAsyncApiSaveDiagram({
      existing: { id: 'macro-cc', source: DataSource.CustomContent, isCopy: false, diagramType: DiagramType.AsyncApi } as Diagram,
      spec: 'new',
    });
    await new CustomContentStorageProvider(ap).save(diagram);
    expect(ap.saveCustomContentV2).toHaveBeenCalledWith('macro-cc', diagram);
  });
});
