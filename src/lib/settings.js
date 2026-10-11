// User preferences. Everything that needs one (translation popup, toolbar popup, options page,
// quiz) reads it through this module, so there is exactly one stored value per preference.
// Content scripts are classic scripts and cannot import this file; they ask the background
// script, except for the double-click switch, which they read from the same storage key.

const SETTINGS_KEY = 'settings';
const SITE_SOURCES_KEY = 'siteSourceLangs';

export const DEFAULT_SETTINGS = Object.freeze({
  /**
   * Language translations are made into. '' means the user has not chosen yet: until they do,
   * the browser's UI language is used and the UI asks them to confirm or change it.
   */
  targetLang: '',
  /** Id of the active translation provider (see providers/index.js). */
  provider: 'mymemory',
  /** Per-provider configuration (API keys, server URLs), keyed by provider id. */
  providerConfig: {},
  /** Open the translation popup when a word is double-clicked. */
  doubleClick: true,
  /**
   * Only where words are pronounced from recordings (see shared/speech.js): use the browser's
   * own voice for words that have no recording, even though that voice is why recordings are
   * used there in the first place.
   */
  ttsFallback: false,
  /** Flash cards: ask about a saved word from time to time. */
  quizEnabled: true,
  /** A quiz is shown at most this often. */
  quizIntervalMinutes: 20,
  /** The quiz starts once the vault holds this many words. */
  quizMinCards: 10,
  /** When no word is due for review, ask one anyway (the hardest) instead of skipping the quiz. */
  quizAllowNotDue: true,
  /** A quiz nobody answers goes away after this many seconds; nothing is held against the word. */
  quizTimeoutSeconds: 30,
});

/** @returns {Promise<typeof DEFAULT_SETTINGS>} */
export async function getSettings() {
  const stored = (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY];
  return { ...DEFAULT_SETTINGS, ...(stored && typeof stored === 'object' ? stored : {}) };
}

/** @param {Partial<typeof DEFAULT_SETTINGS>} patch */
export async function updateSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

// --- "Always use this source language on this site" ----------------------------------------------

const validHost = (host) => typeof host === 'string' && host.length > 0 && host.length <= 255;

async function siteSources() {
  const stored = (await chrome.storage.local.get(SITE_SOURCES_KEY))[SITE_SOURCES_KEY];
  return stored && typeof stored === 'object' ? stored : {};
}

/** @returns {Promise<string>} Language code pinned for the host, or ''. */
export async function getSiteSource(host) {
  if (!validHost(host)) return '';
  const lang = (await siteSources())[host];
  return typeof lang === 'string' ? lang : '';
}

/** @param {string} host @param {string | null} lang Falsy removes the pin. */
export async function setSiteSource(host, lang) {
  if (!validHost(host)) return;
  const all = await siteSources();
  if (lang) all[host] = lang;
  else delete all[host];
  await chrome.storage.local.set({ [SITE_SOURCES_KEY]: all });
}
