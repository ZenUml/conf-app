import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/utils/requestUtil', () => ({
  callRemote: vi.fn().mockResolvedValue({ dsl: '', diagramId: '', diagramTitle: '', updatedCode: '' }),
}));

vi.mock('@/model/store2', () => ({
  default: { dispatch: vi.fn() },
}));

vi.mock('@/model/globals', () => ({
  default: {
    apWrapper: {
      getCurrentPage: vi.fn().mockResolvedValue({
        title: 'Test Page',
        body: { export_view: { value: 'content' } },
      }),
      _getCurrentUser: vi.fn().mockResolvedValue({ atlassianAccountId: 'acc-1' }),
    },
  },
}));

import { callRemote } from '@/utils/requestUtil';
import { generateDiagramFromPage, fixDiagram, diagramlyChat } from '@/services/GenerateService';
import { DiagramType } from '@/model/Diagram/Diagram';

describe('GenerateService URLs are Forge-clean (no xdm_e, no addonKey)', () => {
  beforeEach(() => {
    vi.mocked(callRemote).mockClear();
  });

  it('generateDiagramFromPage does not include xdm_e or addonKey query params', async () => {
    await generateDiagramFromPage(DiagramType.Sequence, 'test prompt').catch(() => {});
    expect(vi.mocked(callRemote)).toHaveBeenCalled();
    const url = vi.mocked(callRemote).mock.calls[0][0] as string;
    expect(url).not.toContain('xdm_e');
    expect(url).not.toContain('addonKey');
  });

  it('diagramlyChat does not include xdm_e or addonKey query params', async () => {
    await diagramlyChat([]).catch(() => {});
    expect(vi.mocked(callRemote)).toHaveBeenCalled();
    const url = vi.mocked(callRemote).mock.calls[0][0] as string;
    expect(url).not.toContain('xdm_e');
    expect(url).not.toContain('addonKey');
  });

  it('fixDiagram does not include xdm_e or addonKey query params', async () => {
    await fixDiagram('content', 'error', DiagramType.Sequence).catch(() => {});
    expect(vi.mocked(callRemote)).toHaveBeenCalled();
    const url = vi.mocked(callRemote).mock.calls[0][0] as string;
    expect(url).not.toContain('xdm_e');
    expect(url).not.toContain('addonKey');
  });
});
