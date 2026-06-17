/**
 * Smart Cache System — централізована система кешу.
 *
 * Стратегії:
 * 1. TTL Cache — час життя
 * 2. LRU Cache — least recently used
 * 3. Write-Through — запис через кеш
 * 4. Cache Invalidation — інвалідація
 */

type CacheEntry<T> = {
  value: T;
  expires: number;
  accessCount: number;
  lastAccess: number;
};

export class SmartCache<T = unknown> {
  private store = new Map<string, CacheEntry<T>>();
  private maxSize: number;
  private defaultTtl: number;

  constructor(options: { maxSize?: number; defaultTtlMs?: number } = {}) {
    this.maxSize = options.maxSize ?? 1000;
    this.defaultTtl = options.defaultTtlMs ?? 5 * 60 * 1000;
  }

  get(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expires) {
      this.store.delete(key);
      return null;
    }

    entry.accessCount++;
    entry.lastAccess = Date.now();
    return entry.value;
  }

  set(key: string, value: T, ttlMs?: number): void {
    if (this.store.size >= this.maxSize) {
      this.evict();
    }

    this.store.set(key, {
      value,
      expires: Date.now() + (ttlMs ?? this.defaultTtl),
      accessCount: 0,
      lastAccess: Date.now(),
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

  private evict(): void {
    // LRU eviction
    let oldestKey = "";
    let oldestAccess = Infinity;

    for (const [key, entry] of this.store.entries()) {
      if (entry.lastAccess < oldestAccess) {
        oldestAccess = entry.lastAccess;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.store.delete(oldestKey);
    }
  }
}

// Singleton cache instance
export const cache = new SmartCache({ maxSize: 5000, defaultTtlMs: 5 * 60 * 1000 });
