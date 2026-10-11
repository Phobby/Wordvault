// User settings live under one key in chrome.storage.local. Content scripts read the same key
// directly (they are classic scripts and cannot import this module), so keep the shape flat.

const STORAGE_KEY = 'settings';

export const DEFAULT_SETTINGS = Object.freeze({
  /** Target language code; '' means "follow the browser's UI language". */
  targetLang: '',
  /** Id of the active translation provider (see providers/index.js). */
  provider: 'mymemory',
  /** Per-provider configuration (API keys, server URLs), keyed by provider id. */
  providerConfig: {},
  /** Open the translation popup when a word is double-clicked. */
  doubleClick: true,
});

/** @returns {Promise<typeof DEFAULT_SETTINGS>} */
export async function getSettings() {
  const stored = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY];
  return { ...DEFAULT_SETTINGS, ...(stored && typeof stored === 'object' ? stored : {}) };
}

/** @param {Partial<typeof DEFAULT_SETTINGS>} patch */
export async function updateSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
  return next;
}
