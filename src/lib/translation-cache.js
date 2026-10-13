// A small memory of translations, on this device only: asking for the same word again within a
// week does not ask the service again (and does not use up a quota again).
//
// What is kept is what the service answered for a text, per service and language pair: the
// answers of two services for the same text never mix. It lives in chrome.storage.local and is
// part of neither the backup nor synchronisation.

const CACHE_KEY = 'translationCache';
export const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_ENTRIES = 300;

/**
 * @param {{ provider: string, source: string | null, target: string, text: string }} request
 * @returns {string} One key per service, language pair and text.
 */
export function cacheKey({ provider, source, target, text }) {
  return [provider, source || 'auto', target, text].join('\u0001');
}

/** What is still worth keeping: young enough, and no more than the newest MAX_ENTRIES. */
export function prune(entries, now = Date.now()) {
  const fresh = Object.entries(entries || {}).filter(([, entry]) => entry && now - entry.at < MAX_AGE_MS && entry.at <= now);
  fresh.sort((a, b) => b[1].at - a[1].at);
  return Object.fromEntries(fresh.slice(0, MAX_ENTRIES));
}

async function read() {
  const stored = (await chrome.storage.local.get(CACHE_KEY))[CACHE_KEY];
  return stored && typeof stored === 'object' ? stored : {};
}

/** @returns {Promise<Object | null>} The remembered answer, or null. */
export async function getCached(request, now = Date.now()) {
  const entry = (await read())[cacheKey(request)];
  return entry && now - entry.at < MAX_AGE_MS && entry.at <= now ? entry.result : null;
}

/** Remembers an answer. Never throws: a full disk must not break a translation. */
export async function putCached(request, result, now = Date.now()) {
  try {
    const entries = await read();
    entries[cacheKey(request)] = { at: now, result };
    await chrome.storage.local.set({ [CACHE_KEY]: prune(entries, now) });
  } catch {
    // not remembered; it will be asked for again
  }
}

export async function clearCache() {
  await chrome.storage.local.remove(CACHE_KEY);
}
