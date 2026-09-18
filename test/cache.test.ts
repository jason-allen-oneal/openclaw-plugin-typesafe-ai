import { describe, it, expect, beforeEach } from "vitest";
import { LruCache, computeDecisionHash } from "../src/cache.js";

describe("LruCache", () => {
  let cache: LruCache<string, string>;

  beforeEach(() => {
    cache = new LruCache({ maxEntries: 3, defaultTtlMs: 1000 });
  });

  it("stores and retrieves items within TTL", () => {
    cache.set("key1", "val1");
    expect(cache.get("key1")).toBe("val1");
    expect(cache.has("key1")).toBe(true);

    const stats = cache.getStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(0);
    expect(stats.size).toBe(1);
  });

  it("returns undefined and counts a miss for unknown keys", () => {
    expect(cache.get("unknown")).toBeUndefined();
    expect(cache.has("unknown")).toBe(false);

    const stats = cache.getStats();
    expect(stats.misses).toBe(1);
    expect(stats.hits).toBe(0);
  });

  it("evicts least recently used item when maxEntries is exceeded", () => {
    cache.set("a", "1");
    cache.set("b", "2");
    cache.set("c", "3");

    // Access "a" to make it more recently used than "b"
    expect(cache.get("a")).toBe("1");

    // Adding "d" should evict "b" (since "a" was refreshed and "c" was added after "b")
    cache.set("d", "4");

    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe("1");
    expect(cache.get("c")).toBe("3");
    expect(cache.get("d")).toBe("4");

    const stats = cache.getStats();
    expect(stats.evictions).toBe(1);
    expect(stats.size).toBe(3);
  });

  it("expires items past TTL", async () => {
    const shortTtlCache = new LruCache<string, string>({ maxEntries: 5, defaultTtlMs: 50 });
    shortTtlCache.set("temp", "value");
    expect(shortTtlCache.get("temp")).toBe("value");

    await new Promise((resolve) => setTimeout(resolve, 70));

    expect(shortTtlCache.get("temp")).toBeUndefined();
    expect(shortTtlCache.has("temp")).toBe(false);
  });

  it("clears all items and resets statistics", () => {
    cache.set("x", "1");
    cache.set("y", "2");
    expect(cache.size).toBe(2);

    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get("x")).toBeUndefined();
    expect(cache.getStats().size).toBe(0);
  });
});

describe("computeDecisionHash", () => {
  it("produces deterministic hash regardless of key insertion order", () => {
    const objA = { path: "/tmp/foo.txt", encoding: "utf-8", flag: "r" };
    const objB = { flag: "r", encoding: "utf-8", path: "/tmp/foo.txt" };

    const hashA = computeDecisionHash(objA);
    const hashB = computeDecisionHash(objB);

    expect(hashA).toBe(hashB);
    expect(hashA).toMatch(/^[a-f0-9]{64}$/);
  });

  it("produces distinct hashes for different payloads", () => {
    const hash1 = computeDecisionHash({ command: "git status" });
    const hash2 = computeDecisionHash({ command: "git diff" });

    expect(hash1).not.toBe(hash2);
  });
});
