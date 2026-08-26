import { describe, expect, it } from 'vitest';
import {
  findArchitectureTokenDirectoryEntry,
  noArchitectureTokenDirectory,
  resolveArchitectureTokenDirectory,
} from './architectureTokenDirectory';

describe('Architecture Token local directory contract', () => {
  it('accepts a local, browser-provided directory without persisting or inventing token identity', async () => {
    const raw = [{
      logicalTokenId: 'logical-orders',
      tokenId: 'enterprise-orders',
      displayName: 'Orders service',
    }];

    const directory = resolveArchitectureTokenDirectory(raw);

    expect(directory).toEqual({
      kind: 'available',
      entries: [{
        logicalTokenId: 'logical-orders',
        tokenId: 'enterprise-orders',
        displayName: 'Orders service',
      }],
    });
    if (directory.kind !== 'available') return;
    expect(findArchitectureTokenDirectoryEntry(directory, 'logical-orders')).toEqual(directory.entries[0]);
    expect(findArchitectureTokenDirectoryEntry(directory, 'missing-token')).toBeUndefined();
    expect(directory.entries[0]).not.toBe(raw[0]);
  });

  it.each([
    ['an empty display name', [{ logicalTokenId: 'logical-orders', displayName: '  ' }]],
    ['an unknown field', [{ logicalTokenId: 'logical-orders', displayName: 'Orders', unsafe: true }]],
    ['a duplicate logical token', [
      { logicalTokenId: 'logical-orders', displayName: 'Orders' },
      { logicalTokenId: 'logical-orders', displayName: 'Orders again' },
    ]],
    ['a duplicate external token', [
      { logicalTokenId: 'logical-orders', tokenId: 'enterprise-orders', displayName: 'Orders' },
      { logicalTokenId: 'logical-orders-duplicate', tokenId: 'enterprise-orders', displayName: 'Orders copy' },
    ]],
  ])('fails closed for %s', (_caseName, raw) => {
    expect(resolveArchitectureTokenDirectory(raw)).toEqual({
      kind: 'unavailable',
      reason: 'invalid_directory',
    });
  });

  it('has no implicit directory when no approved local provider is configured', async () => {
    await expect(noArchitectureTokenDirectory.list()).resolves.toEqual({
      kind: 'unavailable',
      reason: 'not_configured',
    });
  });
});
