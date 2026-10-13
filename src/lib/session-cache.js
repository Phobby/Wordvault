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

/** Empties the layer (and only it: other things kept for the session stay). */
export async function clearSession() {
  const storage = area();
  if (!storage) return;
  try {
    const keys = Object.keys(await storage.get(null)).filter((key) => key.startsWith(PREFIX) || key === COUNT_KEY);
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
