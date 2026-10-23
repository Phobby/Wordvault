// User preferences. Everything that needs one (translation popup, toolbar popup, options page,
// quiz) reads it through this module, so there is exactly one stored value per preference.
// Content scripts are classic scripts and cannot import this file; they ask the background
// script, except for the double-click switch, which they read from the same storage key.

const SETTINGS_KEY = 'settings';
const SITE_SOURCES_KEY = 'siteSourceLangs';

export const DEFAULT_SETTINGS = Object.freeze({
  /** The shape of the stored settings (migrateSettings). */
  settingsVersion: 2,
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
  /** Speaking rate of the browser's voices (shared/voices.js: RATE): a little slower than normal, for learners. */
  speechRate: 0.9,
  /** Remote voices (Chrome's Google voices, Edge's natural voices) may be used: they send the word to their vendor. */
  speechOnline: false,
  /** A human recording (Wikimedia Commons, through Wiktionary) is played where one exists: the word goes to Wiktionary. */
  speechRecordings: false,
  /** Flash cards: ask about a saved word from time to time. */
  quizEnabled: true,
  /** A quiz is shown at most this often. */
  quizIntervalMinutes: 20,
  /** When no word is due for review, ask one anyway (the hardest) instead of skipping the quiz. */
  quizAllowNotDue: true,
  /** A quiz nobody answers goes away after this many seconds; nothing is held against the word. */
  quizTimeoutSeconds: 30,
  /** How many questions a quiz asks, one after the other in the same place. */
  quizQuestionsPerQuiz: 1,
  /**
   * How a quiz is put on screen: 'popup' (the toolbar popup), 'window' (a small window of its
   * own), 'card' (a card on the page), or 'auto' (in that order, whichever works first).
   * Whatever is chosen, the other ways follow when it is not possible (quiz/display.js).
   */
  quizDisplay: 'auto',
  /** Writing: an answer that differs only in accents ("cafe" for "café") counts as right. */
  quizAccentTolerant: true,
  /** Listening and expert: say the word once when the question appears. */
  quizListenAutoplay: true,
  /** Listening: what the four choices are: 'meaning' (translations) or 'spelling' (the words themselves). */
  quizListenChoices: 'meaning',
  /** A word is learned after this many right answers in a row, on at least three different days. */
  quizLearnedStreak: 5,
  /** ... of which at least one has to be from a level above easy: typed or heard, not picked from four. */
  quizLearnedNeedsOtherMode: true,
  /** A day counts for the streak once this many questions were answered on it. */
  quizDailyGoal: 5,
  /** One missed day a week can be covered by a freeze. */
  quizFreezeEnabled: true,
  /** In the evening, if the day's quiz is not done yet, say so once (needs the notification permission). */
  quizReminderEnabled: true,
  /** When: 'HH:MM', local time. */
  quizReminderTime: '20:00',
  /** No quiz and no reminder between these times of day ('HH:MM'; both empty: no quiet hours). */
  quizQuietStart: '',
  quizQuietEnd: '',
  /** "Translate with Wordvault" in the right-click menu of selected text. */
  contextMenuTranslate: true,
  /** A small "Translate" button next to a selection of more than one word. */
  selectionButton: true,
  /** A translated passage is also shown in the page, in place of the selected text, with a switch back to the original. */
  passageInPlace: true,
  /** Screen text scanning: start the next selection with the area that was scanned last. */
  ocrRememberArea: false,
  /** Screen text scanning, for troubleshooting: draw the box of every word that was found. */
  ocrShowBoxes: false,
});

/**
 * Settings that are gone. They may still be stored by an older version; they are dropped when
 * read, and from storage with the next write.
 *   quizMinCards                 the quiz starts with any vault; the choices need four meanings, no more
 *   quizMode*                    the quiz that comes by itself asks at the level chosen in the toolbar popup
 *   quizIncludePhrases           phrases are never asked
 *   ocrLanguages, ocrMinConfidence  the scan reads with every bundled language, at a fixed confidence
 */
export const REMOVED_SETTINGS = Object.freeze(['quizMinCards', 'quizModeClassic', 'quizModeWriting', 'quizModeListening', 'quizModeExpert', 'quizIncludePhrases', 'ocrLanguages', 'ocrMinConfidence']);

/**
 * Stored settings of any earlier version, in the current shape. Pure.
 * Version 2: accent tolerance became the default. Every older store holds the old default
 * (false) whether or not it was chosen, so it is switched on once; the user can switch it off.
 * @param {object | undefined} stored
 */
export function migrateSettings(stored) {
  const settings = { ...(stored && typeof stored === 'object' ? stored : {}) };
  for (const key of REMOVED_SETTINGS) delete settings[key];
  if (!(Number(settings.settingsVersion) >= 2)) settings.quizAccentTolerant = true;
  settings.settingsVersion = DEFAULT_SETTINGS.settingsVersion;
  return settings;
}

/** @returns {Promise<typeof DEFAULT_SETTINGS>} */
export async function getSettings() {
  const stored = (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY];
  return { ...DEFAULT_SETTINGS, ...migrateSettings(stored) };
}

/** Writes stored settings of an older version back in the current shape (at start-up). */
export function upgradeStoredSettings() {
  const done = turns.then(async () => {
    const stored = (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY];
    if (!stored || typeof stored !== 'object') return false;
    const stale = stored.settingsVersion !== DEFAULT_SETTINGS.settingsVersion || REMOVED_SETTINGS.some((key) => key in stored);
    if (stale) await chrome.storage.local.set({ [SETTINGS_KEY]: migrateSettings(stored) });
    return stale;
  });
  turns = done.catch(() => {});
  return done;
}

// Changing a setting is "read all of them, change one, write all of them". Two changes made
// at the same moment from one page (two switches flipped in a row) would each read the old
// state and the second would undo the first, so they take turns. Only the order is kept here.
let turns = Promise.resolve();

/** @param {Partial<typeof DEFAULT_SETTINGS>} patch */
export function updateSettings(patch) {
  const done = turns.then(async () => {
    const next = { ...(await getSettings()), ...patch };
    await chrome.storage.local.set({ [SETTINGS_KEY]: next });
    return next;
  });
  turns = done.catch(() => {});
  return done;
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
