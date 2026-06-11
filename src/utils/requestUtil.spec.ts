import { describe, it, expect } from 'vitest';
import { loadPaginatedDataUntil } from './requestUtil';

describe('loadPaginatedDataUntil', () => {
  const pages: Record<string, any> = {
    '/start': { results: [1, 2, 3], _links: { next: '/wiki/p2' } },
    '/p2': { results: [4, 5, 6], _links: { next: '/wiki/p3' } },
    '/p3': { results: [7], _links: {} },
  };

  it('stops paginating once shouldStop() returns true', async () => {
    const requestFunc = vi.fn(async (url: string) => pages[url]);
    let count = 0;
    await loadPaginatedDataUntil(requestFunc, '/start', (d: any) => { count += d.results.length; }, () => count >= 4);
    // page1 (3) → not stop → page2 (6) → stop; page3 never fetched
    expect(requestFunc).toHaveBeenCalledTimes(2);
    expect(count).toBe(6);
  });

  it('exhausts all pages when shouldStop() never returns true', async () => {
    const requestFunc = vi.fn(async (url: string) => pages[url]);
    let count = 0;
    await loadPaginatedDataUntil(requestFunc, '/start', (d: any) => { count += d.results.length; }, () => false);
    expect(requestFunc).toHaveBeenCalledTimes(3);
    expect(count).toBe(7);
  });
});
