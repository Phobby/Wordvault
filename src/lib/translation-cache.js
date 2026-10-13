// The lasting memory of translations, on this device only: asking for the same word again does
// not ask the service again (and does not use up a quota again).
//
// SPEC.md, section 7: an entry carries the time it was last asked for (`seen`); one that
// nobody asked for in seven days is deleted, by a clean-up that runs once a day and when the
// extension wakes up. Words in the vault are something else entirely (other storage keys) and
// are never touched from here.
//
// What is kept is what a service answered for a text, per service and language pair: the
// answers of two services for the same text never mix. It lives in chrome.storage.local under
// one key and is part of neither the backup, nor synchronisation, nor feedback.

export const CACHE_KEY = 'translationCache';
/** An entry nobody asked for in this long is deleted. */
export const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** No more entries than this; the ones asked for longest ago go first. */
export const MAX_ENTRIES = 500;
/** Being asked for again is written down at most this often per entry: seven days do not need the minute. */
export const TOUCH_AFTER_MS = 60 * 60 * 1000;
/** The clean-up on waking up runs at most this often; the daily alarm runs regardless. */
export const CLEANUP_EVERY_MS = 6 * 60 * 60 * 1000;
export const CLEANUP_ALARM = 'wv:cache:cleanup';
const VERSION = 2;

/**
 * @param {{ provider: string, source: string | null, target: string, text: string }} request
 * @returns {string} One key per service, language pair and text.
 */
export function cacheKey({ provider, source, target, text }) {
  return [provider, source || 'auto', target, text].join('\u0001');
}

const alive = (entry, now) => Boolean(entry) && Number.isFinite(entry.seen) && entry.seen <= now && now - entry.seen < MAX_AGE_MS;

/**
 * What is still worth keeping: asked for within the last seven days, and no more than
 * MAX_ENTRIES of those, the most recently asked for first.
 */
export function prune(entries, now = Date.now()) {
  const fresh = Object.entries(entries || {}).filter(([, entry]) => alive(entry, now));
  fresh.sort((a, b) => b[1].seen - a[1].seen);
  return Object.fromEntries(fresh.slice(0, MAX_ENTRIES));
}

/** The stored state: { v, cleanedAt, entries: { key: { seen, result } } }. Anything else is started afresh. */
async function read() {
  const stored = (await chrome.storage.local.get(CACHE_KEY))[CACHE_KEY];
  if (stored && stored.v === VERSION && stored.entries && typeof stored.entries === 'object') return stored;
  return { v: VERSION, cleanedAt: 0, entries: {} };
}

const write = (state) => chrome.storage.local.set({ [CACHE_KEY]: state });

/**
 * @returns {Promise<Object | null>} The remembered answer, or null. Being asked for counts:
 *          the entry's seven days start again.
 */
export async function getCached(request, now = Date.now()) {
  const state = await read();
  const key = cacheKey(request);
  const entry = state.entries[key];
  if (!alive(entry, now)) return null;
  if (now - entry.seen >= TOUCH_AFTER_MS) {
    entry.seen = now;
    await write(state).catch(() => {});
  }
  return entry.result;
}

/** Remembers an answer. Never throws: a full disk must not break a translation. */
export async function putCached(request, result, now = Date.now()) {
  try {
    const state = await read();
    state.entries[cacheKey(request)] = { seen: now, result };
    // Only over the limit is anything thrown out here; what is too old goes with the clean-up.
    if (Object.keys(state.entries).length > MAX_ENTRIES) state.entries = prune(state.entries, now);
    await write(state);
  } catch {
    // not remembered; it will be asked for again
  }
}

/**
 * Deletes what nobody asked for in seven days.
 * @returns {Promise<{ removed: number, kept: number }>}
 */
export async function cleanupCache(now = Date.now()) {
  const state = await read();
  const before = Object.keys(state.entries).length;
  state.entries = prune(state.entries, now);
  state.cleanedAt = now;
  await write(state);
  const kept = Object.keys(state.entries).length;
  return { removed: before - kept, kept };
}

/**
 * Keeps the daily clean-up scheduled, and cleans up now if the last time is long enough ago.
 * Called whenever the background script starts, for whatever reason: the alarm survives the
 * script being stopped, but not always a browser restart, and a browser that was closed for a
 * week has entries to delete right away. Nothing is kept in memory; the time of the last
 * clean-up is stored with the cache.
 */
export async function ensureCacheCleanup(now = Date.now()) {
  if (!(await chrome.alarms.get(CLEANUP_ALARM))) {
    await chrome.alarms.create(CLEANUP_ALARM, { delayInMinutes: 24 * 60, periodInMinutes: 24 * 60 });
  }
  const { cleanedAt } = await read();
  if (!(now - cleanedAt < CLEANUP_EVERY_MS) || cleanedAt > now) await cleanupCache(now);
}

/** How much is remembered: for the settings page. */
export async function cacheStats() {
  const state = await read();
  return { entries: Object.keys(state.entries).length, bytes: new TextEncoder().encode(JSON.stringify(state)).length, cleanedAt: state.cleanedAt };
}

export async function clearCache() {
  await write({ v: VERSION, cleanedAt: Date.now(), entries: {} });
}
