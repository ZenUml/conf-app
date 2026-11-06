import { afterEach, describe, expect, it } from 'vitest';
import MacroUtil from '@/model/MacroUtil';
import forgeGlobal from '@/model/globals/forgeGlobal';

describe('MacroUtil.isCreateNew', () => {
  afterEach(() => {
    (forgeGlobal as any).forgeContext = undefined;
  });

  it('treats a Forge macro with customContentId as an existing macro even without legacy uuid', async () => {
    // This is the current Forge runtime shape: extension.config carries the
    // V2 custom-content id, while legacy Connect-era uuid is absent.
    (forgeGlobal as any).forgeContext = {
      extension: {
        config: {
          customContentId: 'custom-content-123',
        },
      },
    };

    await expect(MacroUtil.isCreateNew()).resolves.toBe(false);
  });

  it('treats a Forge macro without customContentId as new', async () => {
    (forgeGlobal as any).forgeContext = {
      extension: {
        config: {},
      },
    };

    await expect(MacroUtil.isCreateNew()).resolves.toBe(true);
  });
});
