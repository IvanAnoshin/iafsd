const CACHE_PREFIX = 'friendscape:page-cache:';
const MEMORY_STORE_KEY = '__friendscapePageCacheStore__';

function getMemoryStore() {
  if (typeof globalThis === 'undefined') return new Map();
  if (!globalThis[MEMORY_STORE_KEY]) {
    globalThis[MEMORY_STORE_KEY] = new Map();
  }
  return globalThis[MEMORY_STORE_KEY];
}

function isFresh(entry, maxAgeMs) {
  if (!entry || typeof entry !== 'object') return false;
  if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) return true;
  const savedAt = Number(entry.savedAt || 0);
  if (!savedAt) return false;
  return Date.now() - savedAt <= maxAgeMs;
}

export function readPageCache(key, maxAgeMs = 5 * 60 * 1000) {
  if (!key) return null;

  const memoryStore = getMemoryStore();
  const memoryEntry = memoryStore.get(key);
  if (isFresh(memoryEntry, maxAgeMs)) return memoryEntry.data;

  if (typeof window === 'undefined') return null;

  try {
    const raw = window.sessionStorage.getItem(`${CACHE_PREFIX}${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!isFresh(parsed, maxAgeMs)) {
      window.sessionStorage.removeItem(`${CACHE_PREFIX}${key}`);
      return null;
    }
    memoryStore.set(key, parsed);
    return parsed.data;
  } catch {
    return null;
  }
}

export function writePageCache(key, data) {
  if (!key) return;
  const entry = { savedAt: Date.now(), data };
  const memoryStore = getMemoryStore();
  memoryStore.set(key, entry);

  if (typeof window === 'undefined') return;

  try {
    window.sessionStorage.setItem(`${CACHE_PREFIX}${key}`, JSON.stringify(entry));
  } catch {
    // ignore quota / serialization errors for UI cache
  }
}

export function clearPageCache(key) {
  if (!key) return;
  const memoryStore = getMemoryStore();
  memoryStore.delete(key);

  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(`${CACHE_PREFIX}${key}`);
  } catch {
    // ignore cache cleanup errors
  }
}
