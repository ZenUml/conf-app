import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/utils/requestUtil', () => ({
  callRemote: vi.fn().mockResolvedValue({ dsl: '', diagramId: '', diagramTitle: '', updatedCode: '' }),
}));

vi.mock('@/model/globals', () => ({
  default: {
    apWrapper: {
      _getCurrentUser: vi.fn().mockResolvedValue({ atlassianAccountId: 'acc-1' }),
    },
  },
}));

import { callRemote } from '@/utils/requestUtil';
import { startFixDiagram, diagramlyChat } from '@/services/GenerateService';
import { DiagramType } from '@/model/Diagram/Diagram';

describe('GenerateService URLs are Forge-clean (no xdm_e, no addonKey)', () => {
  beforeEach(() => {
    vi.mocked(callRemote).mockClear();
  });

  it('diagramlyChat does not include xdm_e or addonKey query params', async () => {
    await diagramlyChat([]).catch(() => {});
    expect(vi.mocked(callRemote)).toHaveBeenCalled();
    const url = vi.mocked(callRemote).mock.calls[0][0] as string;
    expect(url).not.toContain('xdm_e');
    expect(url).not.toContain('addonKey');
  });

  it('startFixDiagram does not include xdm_e or addonKey query params', async () => {
    await startFixDiagram('content', 'error', DiagramType.Sequence).catch(() => {});
    expect(vi.mocked(callRemote)).toHaveBeenCalled();
    const url = vi.mocked(callRemote).mock.calls[0][0] as string;
    expect(url).not.toContain('xdm_e');
    expect(url).not.toContain('addonKey');
  });
});
