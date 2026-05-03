import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DiagramType } from '@/model/Diagram/Diagram';
import { syncCustomContent } from './CustomContent';
import { callRemote } from '@/utils/requestUtil';
import { getClientDomain } from '@/utils/ContextParameters/ContextParameters';
import { trackEvent, addonKey } from '@/utils/window';

vi.mock('@/utils/ContextParameters/ContextParameters', () => ({
  getClientDomain: vi.fn(),
}));

vi.mock('@/utils/requestUtil', () => ({
  callRemote: vi.fn(),
}));

vi.mock('@/utils/window', () => ({
  trackEvent: vi.fn(),
  addonKey: vi.fn(() => 'test-addon'),
  serializeError: vi.fn((e: unknown) => e instanceof Error ? e.message : String(e)),
}));

vi.mock('@/model/globals/forgeGlobal', () => ({
  default: {
    isForge: false,
  },
}));

describe('syncCustomContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(addonKey).mockReturnValue('test-addon');
  });

  it('skips remote sync for the blocked client domain hash', async () => {
    vi.mocked(getClientDomain).mockReturnValue('blocked-domain-example');

    await syncCustomContent({ id: 'content-1' }, DiagramType.Sequence, 'macro-1');

    expect(callRemote).not.toHaveBeenCalled();
    expect(trackEvent).not.toHaveBeenCalled();
  });

  it('syncs custom content for other domains', async () => {
    vi.mocked(getClientDomain).mockReturnValue('another-domain');
    vi.mocked(callRemote).mockResolvedValue(undefined);

    await syncCustomContent({ id: 'content-2' }, DiagramType.Graph, 'macro-2');

    expect(callRemote).toHaveBeenCalledWith('/forge-custom-content', 'POST', {
      clientDomain: 'another-domain',
      addonKey: 'test-addon',
      contentId: 'content-2',
      customContentId: 'content-2',
      diagramType: DiagramType.Graph,
      macroUuid: 'macro-2',
    });
    expect(trackEvent).toHaveBeenCalledWith('', 'sync_custom_content', 'success');
  });
});
