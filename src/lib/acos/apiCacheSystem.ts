/**
 * Smart API Cache — кешування API відповідей.
 *
 * Стратегії:
 * 1. In-memory cache — в пам'яті
 * 2. Redis cache — Redis (майбутнє)
 * 3. CDN cache — CDN (майбутнє)
 */

type CacheEntry<T> = {
  data: T;
  expires: number;
};

export class ApiCache {
  private store = new Map<string, CacheEntry<unknown>>();
  private defaultTtl: number;

  constructor(defaultTtlMs: number = 5 * 60 * 1000) {
    this.defaultTtl = defaultTtlMs;
  }

  get<T>(key: string): T | null {
    const entry = this.store.get(key) as CacheEntry<T> | undefined;
    if (!entry) return null;

    if (Date.now() > entry.expires) {
      this.store.delete(key);
      return null;
    }

    return entry.data;
  }

  set<T>(key: string, data: T, ttlMs?: number): void {
    this.store.set(key, {
      data,
      expires: Date.now() + (ttlMs ?? this.defaultTtl),
    });
  }

  delete(key: string): boolean {
    return this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  size(): number {
    return this.store.size;
  }

  cleanup(): number {
    const now = Date.now();
    let count = 0;

    for (const [key, entry] of this.store.entries()) {
      if (now > entry.expires) {
        this.store.delete(key);
        count++;
      }
    }

    return count;
  }
}

// Singleton API cache
export const apiCache = new ApiCache();
