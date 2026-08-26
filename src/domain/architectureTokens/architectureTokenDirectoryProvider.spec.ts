import { describe, expect, it } from 'vitest';
import {
  createBrowserLocalArchitectureTokenDirectoryProvider,
  noBrowserLocalArchitectureTokenDirectoryProvider,
} from './architectureTokenDirectory';

describe('browser-local Architecture Token directory provider', () => {
  it('takes a strict, read-only directory snapshot without any loading seam', () => {
    const provider = createBrowserLocalArchitectureTokenDirectoryProvider([{
      logicalTokenId: 'logical-orders',
      tokenId: 'enterprise-orders',
      displayName: 'Orders service',
    }]);

    expect(provider.locality).toBe('browser_local');
    expect(provider.snapshot()).toEqual({
      kind: 'available',
      entries: [{
        logicalTokenId: 'logical-orders',
        tokenId: 'enterprise-orders',
        displayName: 'Orders service',
      }],
    });
  });

  it('has no configured directory until an explicit provider is injected', () => {
    expect(noBrowserLocalArchitectureTokenDirectoryProvider.snapshot()).toEqual({
      kind: 'unavailable',
      reason: 'not_configured',
    });
  });
});
