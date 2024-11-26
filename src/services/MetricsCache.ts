import ApWrapper2 from "@/model/ApWrapper2";

interface CacheEntry<T> {
  data: T;
  lastUpdated: string;
}

export class MetricsCache<T> {
  private readonly ONE_DAY_MS = 86400000;
  private cachedEntry: CacheEntry<T> | null = null;

  constructor(
    private readonly apWrapper: ApWrapper2,
    private readonly cachePrefix: string
  ) {}

  async get(space: string): Promise<T | null> {
    const key = this.getCacheKey(space);
    this.cachedEntry = await this.apWrapper.getAppProperty(key) as CacheEntry<T> | null;

    if (!this.isExpired()) {
      return this.cachedEntry?.data ?? null;
    }

    return null;
  }

  async set(space: string, data: T): Promise<void> {
    const key = this.getCacheKey(space);
    this.cachedEntry = {
      data,
      lastUpdated: new Date().toISOString()
    };
    await this.apWrapper.setAppProperty(key, this.cachedEntry);
  }

  private getCacheKey(space: string): string {
    return `${this.cachePrefix}_${space}`;
  }

  private isExpired(): boolean {
    if (!this.cachedEntry?.lastUpdated) {
      return true;
    }
    return new Date(this.cachedEntry.lastUpdated).getTime() + this.ONE_DAY_MS < Date.now();
  }
}