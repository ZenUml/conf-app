import { describe, expect, it } from 'vitest';
import { normalizeSourceForHash, sha256NormalizedSource } from './sourceRevision';

describe('SourceRevision hashing', () => {
  it('uses a stable UTF-8 hash for sources that differ only by a BOM or line endings', async () => {
    const unix = 'flowchart LR\n  A --> B\n';
    const windowsWithBom = '\ufeffflowchart LR\r\n  A --> B\r\n';

    expect(normalizeSourceForHash(windowsWithBom)).toBe(unix);
    await expect(sha256NormalizedSource(windowsWithBom)).resolves.toBe(
      await sha256NormalizedSource(unix),
    );
  });

  it('does not erase meaningful source differences while normalizing', () => {
    expect(normalizeSourceForHash('flowchart LR\nA')).not.toBe(normalizeSourceForHash('flowchart LR\nA\n'));
    expect(normalizeSourceForHash('flowchart LR\nA')).not.toBe(normalizeSourceForHash('flowchart LR\n A'));
  });
});
