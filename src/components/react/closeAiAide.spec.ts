import { beforeEach, describe, expect, it, vi } from 'vitest';
import { view } from '@forge/bridge';

import { closeAiAide } from './closeAiAide';

describe('closeAiAide', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('closes the byline modal without submitting it', async () => {
    await closeAiAide();

    expect(view.close).toHaveBeenCalledTimes(1);
    expect(view.submit).not.toHaveBeenCalled();
  });
});
