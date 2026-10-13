// The quick layer in front of the lasting translation cache: chrome.storage.session. It is
// held in memory by the browser, shared by all tabs through the background script, and gone
// when the browser closes. It replaces nothing: whatever is here is in the lasting cache too.
//
// The background script can be stopped at any moment, so nothing is kept in its own variables.
// Web pages' content scripts are not given access to this storage (no setAccessLevel): they ask
// the background script, as for everything else.
//
// Firefox has storage.session from version 115; where it is missing this layer is skipped.

const PREFIX = 'tc\u0001';
const COUNT_KEY = 'tcCount';
/** More than this and the layer is emptied: it is a convenience, the lasting cache has it all. */
export const MAX_SESSION_ENTRIES = 300;

const area = () => globalThis.chrome?.storage?.session || null;

/** @returns {boolean} Whether this browser has the layer at all. */
export const hasSessionCache = () => Boolean(area());

/** @returns {Promise<{ result: Object, touched: number } | null>} */
export async function getSession(key) {
  const storage = area();
  if (!storage) return null;
  try {
    return (await storage.get(PREFIX + key))[PREFIX + key] || null;
  } catch {
    return null;
  }
}

/**
 * @param {string} key      The same key the lasting cache uses (service, language pair, text).
 * @param {Object} result
 * @param {number} touched  When the lasting entry was last marked as asked for.
 */
export async function putSession(key, result, touched = Date.now()) {
  const storage = area();
  if (!storage) return;
  try {
    const known = await storage.get([PREFIX + key, COUNT_KEY]);
    let count = Number(known[COUNT_KEY]) || 0;
    if (!(PREFIX + key in known)) count += 1;
    if (count > MAX_SESSION_ENTRIES) {
      await clearSession();
      count = 1;
    }
    await storage.set({ [PREFIX + key]: { result, touched }, [COUNT_KEY]: count });
  } catch {
    // not kept here; the lasting cache still has it
  }
}

// --- Failures, for a moment ------------------------------------------------------------------
// A request that just failed in a way that asking again will not change (the quota is used
// up, the service has no answer) is not sent again for a short while. The error the user saw
// is what they see again.

const FAIL_PREFIX = 'tn\u0001';
export const FAILURE_MS = 90_000;
/** Failures worth remembering. Not: no network (it may be back any second), a missing or wrong key (the user is about to fix it), a cancelled request. */
export const REMEMBERED_FAILURES = new Set(['rate_limit', 'quota', 'no_result', 'provider_error', 'unsupported_language']);

/** @returns {Promise<{ code: string, detail: string } | null>} */
export async function getFailure(key, now = Date.now()) {
  const storage = area();
  if (!storage) return null;
  try {
    const entry = (await storage.get(FAIL_PREFIX + key))[FAIL_PREFIX + key];
    if (!entry) return null;
    if (entry.until > now && entry.until - now <= FAILURE_MS) return entry.error;
    await storage.remove(FAIL_PREFIX + key);
  } catch {
    // treated as not remembered
  }
  return null;
}

export async function putFailure(key, error, now = Date.now()) {
  const storage = area();
  if (!storage || !REMEMBERED_FAILURES.has(error?.code)) return;
  await storage.set({ [FAIL_PREFIX + key]: { until: now + FAILURE_MS, error: { code: error.code, detail: String(error.detail || '') } } }).catch(() => {});
}

export async function forgetFailure(key) {
  await area()?.remove(FAIL_PREFIX + key).catch(() => {});
}

/** Empties the layer (and only it: other things kept for the session stay). */
export async function clearSession() {
  const storage = area();
  if (!storage) return;
  try {
    const keys = Object.keys(await storage.get(null)).filter((key) => key.startsWith(PREFIX) || key.startsWith(FAIL_PREFIX) || key === COUNT_KEY);
    if (keys.length > 0) await storage.remove(keys);
  } catch {
    // nothing to do
  }
}

/** @returns {Promise<number>} How many answers the layer holds. */
export async function sessionCount() {
  const storage = area();
  if (!storage) return 0;
  try {
    return Object.keys(await storage.get(null)).filter((key) => key.startsWith(PREFIX)).length;
  } catch {
    return 0;
  }
}
