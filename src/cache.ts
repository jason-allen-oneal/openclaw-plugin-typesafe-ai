import { createHash } from "node:crypto";

export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  size: number;
}

export interface LruCacheOptions {
  maxEntries?: number;
  defaultTtlMs?: number;
}

/**
 * High-performance, zero-dependency in-memory LRU cache with TTL expiration.
 * Utilizes JavaScript Map's deterministic iteration order for O(1) LRU eviction.
 */
export class LruCache<K, V> {
  private map: Map<K, CacheEntry<V>>;
  private maxEntries: number;
  private defaultTtlMs: number;
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(options: LruCacheOptions = {}) {
    this.map = new Map();
    this.maxEntries = Math.max(1, options.maxEntries ?? 500);
    this.defaultTtlMs = Math.max(1, options.defaultTtlMs ?? 15 * 60 * 1000); // 15 mins default
  }

  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }

    // Check TTL expiration
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      this.misses++;
      return undefined;
    }

    // Refresh LRU order by deleting and re-inserting
    this.map.delete(key);
    this.map.set(key, entry);
    this.hits++;
    return entry.value;
  }

  set(key: K, value: V, ttlMs?: number): void {
    // If key already exists, delete it first to update order
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxEntries) {
      // Evict least recently used (first key in map iterator)
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) {
        this.map.delete(oldestKey);
        this.evictions++;
      }
    }

    const expiresAt = Date.now() + (ttlMs ?? this.defaultTtlMs);
    this.map.set(key, { value, expiresAt });
  }

  has(key: K): boolean {
    const entry = this.map.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return false;
    }
    return true;
  }

  delete(key: K): boolean {
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  get size(): number {
    return this.map.size;
  }

  getStats(): CacheStats {
    return {
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      size: this.map.size,
    };
  }
}

/**
 * Computes a deterministic SHA-256 hash string for an arbitrary serializable payload.
 */
export function computeDecisionHash(payload: unknown): string {
  const serialized = JSON.stringify(payload, Object.keys(payload as object || {}).sort());
  return createHash("sha256").update(serialized).digest("hex");
}
