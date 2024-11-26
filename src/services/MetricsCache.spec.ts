import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MetricsCache } from './MetricsCache';

describe('MetricsCache', () => {
  const mockSpace = 'TEST-SPACE';
  const TEST_PREFIX = 'TestMetrics';
  const expectedCacheKey = 'TestMetrics_TEST-SPACE';

  const mockApWrapper = {
    getAppProperty: vi.fn(),
    setAppProperty: vi.fn()
  };

  let metricsCache: MetricsCache<{ id: string }>;

  beforeEach(() => {
    vi.clearAllMocks();
    // @ts-ignore - partial mock implementation
    metricsCache = new MetricsCache(mockApWrapper, TEST_PREFIX);
  });

  describe('get', () => {
    it('should return null for expired cache', async () => {
      const oldCache = {
        data: { id: 'test-data' },
        lastUpdated: new Date(Date.now() - 90000000).toISOString() // > 24 hours
      };

      mockApWrapper.getAppProperty.mockResolvedValue(oldCache);

      const result = await metricsCache.get(mockSpace);

      expect(result).toBeNull();
      expect(mockApWrapper.getAppProperty).toHaveBeenCalledWith(expectedCacheKey);
    });

    it('should return data for valid cache', async () => {
      const validCache = {
        data: { id: 'test-data' },
        lastUpdated: new Date().toISOString()
      };

      mockApWrapper.getAppProperty.mockResolvedValue(validCache);

      const result = await metricsCache.get(mockSpace);

      expect(result).toEqual(validCache.data);
      expect(mockApWrapper.getAppProperty).toHaveBeenCalledWith(expectedCacheKey);
    });

    it('should return null for missing cache', async () => {
      mockApWrapper.getAppProperty.mockResolvedValue(null);

      const result = await metricsCache.get(mockSpace);

      expect(result).toBeNull();
    });

    it('should return null for invalid cache format', async () => {
      const invalidCache = {
        data: { id: 'test-data' }
        // missing lastUpdated
      };

      mockApWrapper.getAppProperty.mockResolvedValue(invalidCache);

      const result = await metricsCache.get(mockSpace);

      expect(result).toBeNull();
    });
  });

  describe('set', () => {
    it('should store cache with timestamp', async () => {
      const testData = { id: 'test-data' };

      await metricsCache.set(mockSpace, testData);

      expect(mockApWrapper.setAppProperty).toHaveBeenCalledWith(
        expectedCacheKey,
        expect.objectContaining({
          data: testData,
          lastUpdated: expect.any(String)
        })
      );
    });
  });
});