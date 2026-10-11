// Small read-through cache for upstream API results.
//
// Order: in-memory (lives as long as the isolate) -> Workers KV if the CACHE
// binding exists -> otherwise the Cache API (which only works on custom
// domains, not *.workers.dev). Entries are kept past their freshness window
// so a failed refresh can fall back to the last good data.

import type { KVLike } from "./config";

interface Entry<T> {
  value: T;
  storedAt: number;
}

export interface Cached<T> {
  value: T;
  fetchedAt: number;
  /** True when a refresh failed and this is older data. */
  stale: boolean;
}

export interface WaitUntil {
  waitUntil(promise: Promise<unknown>): void;
}

const memory = new Map<string, Entry<unknown>>();

/** Exposed for tests. */
export function clearMemoryCache(): void {
  memory.clear();
}

function edgeCache(): Cache | null {
  const c = (globalThis as { caches?: CacheStorage & { default?: Cache } }).caches;
  return c?.default ?? null;
}

const cacheUrl = (key: string) => `https://kindle-dashboard.cache/${encodeURIComponent(key)}`;

async function read<T>(key: string, kv?: KVLike): Promise<Entry<T> | null> {
  const mem = memory.get(key) as Entry<T> | undefined;
  if (mem) return mem;
  try {
    if (kv) return ((await kv.get(key, "json")) as Entry<T> | null) ?? null;
    const res = await edgeCache()?.match(cacheUrl(key));
    return res ? ((await res.json()) as Entry<T>) : null;
  } catch {
    return null;
  }
}

async function write<T>(key: string, entry: Entry<T>, keepSeconds: number, kv?: KVLike): Promise<void> {
  memory.set(key, entry);
  const body = JSON.stringify(entry);
  try {
    if (kv) {
      await kv.put(key, body, { expirationTtl: Math.max(60, keepSeconds) });
      return;
    }
    await edgeCache()?.put(
      cacheUrl(key),
      new Response(body, { headers: { "content-type": "application/json", "cache-control": `max-age=${keepSeconds}` } }),
    );
  } catch {
    // Caching is best effort.
  }
}

export async function cached<T>(opts: {
  key: string;
  freshMs: number;
  keepMs: number;
  now: number;
  kv?: KVLike;
  ctx?: WaitUntil;
  fetcher: () => Promise<T>;
}): Promise<Cached<T>> {
  const existing = await read<T>(opts.key, opts.kv);
  if (existing && opts.now - existing.storedAt < opts.freshMs && opts.now >= existing.storedAt) {
    if (!memory.has(opts.key)) memory.set(opts.key, existing);
    return { value: existing.value, fetchedAt: existing.storedAt, stale: false };
  }
  try {
    const value = await opts.fetcher();
    const entry = { value, storedAt: opts.now };
    const pending = write(opts.key, entry, Math.round(opts.keepMs / 1000), opts.kv);
    if (opts.ctx) opts.ctx.waitUntil(pending);
    else await pending;
    return { value, fetchedAt: opts.now, stale: false };
  } catch (err) {
    if (existing && opts.now - existing.storedAt < opts.keepMs) {
      return { value: existing.value, fetchedAt: existing.storedAt, stale: true };
    }
    throw err;
  }
}
