import { describe, expect, it, vi } from 'vitest';
import { createSurveySubmission } from './submission';

describe('targeted survey send', () => {
  it('retries failed feedback with the same idempotency key and retains the answer', async () => {
    const remote = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ ok: true });
    const session = createSurveySubmission({ uuid: 'survey-example', revision: 3 }, 'claim-example', remote);
    await expect(session.send(['editing'], 'A label would help')).rejects.toThrow('offline');
    await expect(session.send(['editing'], 'A label would help')).resolves.toEqual({ ok: true });
    expect(remote).toHaveBeenCalledTimes(2);
    expect(remote.mock.calls[0][2]).toEqual(remote.mock.calls[1][2]);
    expect(remote.mock.calls[1][2]).toMatchObject({ claimToken: 'claim-example', options: ['editing'], text: 'A label would help' });
  });
});
