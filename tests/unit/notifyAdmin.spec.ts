import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/utils/requestUtil', () => ({ callRemote: vi.fn() }));
import { callRemote } from '@/utils/requestUtil';
import { notifyAdmin } from '@/utils/notifyAdmin';

describe('notifyAdmin', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POSTs to /api/notify-admin with the spaceKey + display name', async () => {
    (callRemote as any).mockResolvedValue({ notified: true, adminCount: 2 });
    const result = await notifyAdmin({ spaceKey: 'ENG', requesterDisplayName: 'Alice' });
    expect(callRemote).toHaveBeenCalledWith(
      '/api/notify-admin',
      'POST',
      { spaceKey: 'ENG', requesterDisplayName: 'Alice' }
    );
    expect(result).toEqual({ notified: true, adminCount: 2 });
  });

  it('returns { notified: false, reason: "client_error" } on network failure', async () => {
    (callRemote as any).mockRejectedValue(new Error('boom'));
    const result = await notifyAdmin({ spaceKey: 'ENG' });
    expect(result.notified).toBe(false);
    expect(result.reason).toBe('client_error');
  });
});
