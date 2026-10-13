// Background entry point: a service worker in Chrome, an event page in Firefox. Both can be
// stopped at any time, so nothing is kept in module-level state and every listener is registered
// synchronously at the top level.
//
// All network requests are made from here. Content scripts cannot do it themselves: their
// requests would be subject to the CORS and CSP rules of whatever page they run in.

import { catchUncaught, recordError } from '../features/feedback/error-log.js';
import { sendFeedback } from '../features/feedback/send.js';
import { lookupWord } from '../lib/dictionary.js';
import { ensureSchema } from '../lib/schema.js';
import { registerScreenOcr, screenOcrHandlers } from '../features/screen-ocr/background.js';
import { WordvaultError, serializeError } from '../lib/errors.js';
import { fetchRecording } from '../lib/pronunciation.js';
import { CLEANUP_ALARM, cleanupCache, ensureCacheCleanup } from '../lib/translation-cache.js';
import { cancelTranslation, checkProvider, clearTranslationCaches, getPreferences, setSiteSourceLanguage, setTargetLanguage, translate, translationCacheStats } from '../lib/translator.js';
import { ENTRY_PREFIX, TOMBSTONE_PREFIX, addEntry, entryId, getEntry, hasEntry, removeEntry, updateEntry } from '../lib/vault.js';
import { NOTIFICATION_ID } from '../quiz/display.js';
import { ackRank, freezeYesterday, getProgress } from '../quiz/progress-state.js';
import { REMINDER_ALARM, REMINDER_NOTIFICATION, ensureReminder, runReminder } from '../quiz/reminder.js';
import { DAYS_KEY } from '../quiz/streak.js';
import { ensureSyncScheduled, onSyncAlarm, syncInBackground, turnOffEncryption, unlockEncryption, vaultChanged } from '../sync/engine.js';
import { ALARM_NAME, answerQuestion, claimSession, ensureScheduled, muteToday, openFromNotification, quizPageGone, runScheduledQuiz, testQuiz, unmute } from '../quiz/scheduler.js';

/** Host name of the web page a message came from ('' for extension pages). */
function hostOf(sender) {
  try {
    const url = new URL(sender.url || '');
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.hostname : '';
  } catch {
    return '';
  }
}

/**
 * A translation plus whether the word is already in the vault. A failed translation reports the
 * same thing (in the error's context), because the word can still be saved without one.
 */
async function lookup(payload, sender) {
  try {
    const result = await translate(payload, hostOf(sender));
    return { ...result, saved: await hasEntry(entryId(result)) };
  } catch (error) {
    if (error instanceof WordvaultError && error.context) {
      error.context.saved = await hasEntry(entryId(error.context));
    }
    throw error;
  }
}

/**
 * Fetches word types, definitions and examples for a vault entry that does not have them yet.
 * @returns {Promise<object | null>} The entry as stored afterwards (unchanged if the request failed).
 */
async function enrich(id) {
  const entry = await getEntry(id);
  if (!entry || entry.dictionary) return entry;
  try {
    return await updateEntry(id, { dictionary: await lookupWord(entry.text, entry.sourceLang) });
  } catch {
    return entry; // offline or rate-limited: the vault popup asks again when the word is opened
  }
}

async function save(payload) {
  const entry = await addEntry(payload);
  enrich(entry.id).catch(() => {}); // not awaited: saving does not wait for Wiktionary
  return entry;
}

/**
 * Lets a request through only if it comes from one of the extension's own pages (the options
 * page). What changes where the vault goes, or takes a password, is not for content scripts to
 * ask: they run inside web pages.
 */
function fromOwnPage(handler) {
  return (payload, sender) => {
    if (!String(sender.url || '').startsWith(chrome.runtime.getURL(''))) throw new WordvaultError('internal', 'not allowed from here');
    return handler(payload, sender);
  };
}

/** Message handlers, keyed by message type. Each returns (a promise of) the response data. */
const handlers = {
  'wv:translate': lookup,
  // The user moved on to another word before the answer came.
  'wv:translate:cancel': (payload) => cancelTranslation(payload?.requestId),
  'wv:prefs': (payload, sender) => getPreferences(hostOf(sender)),
  'wv:setTargetLang': (payload) => setTargetLanguage(payload?.code),
  'wv:setSiteSource': (payload, sender) => setSiteSourceLanguage(hostOf(sender), payload?.lang),
  'wv:pronunciation': (payload) => fetchRecording(payload?.text, payload?.lang),
  'wv:vault:add': save,
  'wv:vault:enrich': (payload) => enrich(payload?.id),
  'wv:vault:remove': (payload) => removeEntry(entryId(payload || {})),
  'wv:quiz:test': (payload) => testQuiz(payload),
  // From whatever shows the quiz: a quiz page asking for its question, the outcome of a
  // question, and "not today".
  'wv:quiz:claim': (payload) => claimSession(payload),
  'wv:quiz:answer': (payload) => answerQuestion(payload),
  'wv:quiz:mute': () => muteToday(),
  'wv:quiz:unmute': () => unmute(),
  // The options page asks for this after a quiz setting was changed; see the timer below.
  'wv:quiz:reschedule': () => ensureScheduled(),
  // Streak and rank, for the toolbar popup, the settings page and the quiz card. Numbers only.
  'wv:progress': () => getProgress(),
  'wv:progress:ack-rank': fromOwnPage(() => ackRank()),
  'wv:streak:freeze': fromOwnPage(() => freezeYesterday()),
  // "Sync now" on the options page, and the first synchronisation after connecting.
  'wv:sync:now': fromOwnPage(() => syncInBackground('manual')),
  // Optional encryption of the stored file: the password comes from the options page and is
  // turned into a key here; it is not kept.
  'wv:sync:unlock': fromOwnPage((payload) => unlockEncryption({ password: payload?.password, remember: payload?.remember })),
  'wv:sync:encryption-off': fromOwnPage(() => turnOffEncryption()),
  // "Cache" on the options page: how much is remembered, and forgetting it. The vault is not part of it.
  'wv:cache:stats': fromOwnPage(() => translationCacheStats()),
  'wv:cache:clear': fromOwnPage(() => clearTranslationCaches()),
  // "Test the key" on the options page: the key comes from there and is used for one request.
  'wv:provider:check': fromOwnPage((payload) => checkProvider(payload?.provider, payload?.config)),
  // "Contact and feedback" on the options page, after the user has seen the data and pressed "Send".
  'wv:feedback:send': fromOwnPage((payload) => sendFeedback(payload)),
  ...screenOcrHandlers,
};

// What nothing else caught goes to the local error log (features/feedback/error-log.js). It
// stays on this device unless the user adds it to a piece of feedback.
catchUncaught('background');

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = handlers[message?.type];
  if (!handler || sender.id !== chrome.runtime.id) return false;
  Promise.resolve()
    .then(() => handler(message.payload, sender))
    .then(
      (data) => sendResponse({ ok: true, data }),
      (error) => {
        // An error with a code is an expected one (no network, nothing found); anything else
        // is a fault of the extension. Only the kind of request is noted, never what it carried.
        if (!(error instanceof WordvaultError)) recordError(String(message.type).replace(/^wv:/, ''), error);
        sendResponse({ ok: false, error: serializeError(error) });
      },
    );
  return true; // keep the channel open for the asynchronous response
});

// --- Welcome page ------------------------------------------------------------------------------
// Opened once, when the extension is first installed. The flag guards against browsers that
// report "install" again (a temporary add-on is installed anew every time it is loaded).

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== 'install') return;
  const { welcomeShown } = await chrome.storage.local.get('welcomeShown');
  if (welcomeShown) return;
  await chrome.storage.local.set({ welcomeShown: true });
  chrome.tabs.create({ url: chrome.runtime.getURL('welcome/welcome.html') }).catch(() => {});
});

// --- Screen text scanning ----------------------------------------------------------------------
// Shortcut and menus; see features/screen-ocr/background.js.

registerScreenOcr();

// --- Quiz timer --------------------------------------------------------------------------------
// The alarm survives the background script being stopped, but not always a browser restart, so
// it is checked whenever this script starts, whatever the reason it was started for. A change
// of the settings is acted on at once: the frequency that is set now counts from now, and with
// the quiz switched off there is no alarm at all.

// (The evening reminder follows the same settings and has its own alarm: quiz/reminder.js.)
const scheduleQuiz = () => {
  ensureScheduled().catch(() => {});
  ensureReminder().catch(() => {});
};

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) runScheduledQuiz().catch(() => {});
  else if (alarm.name === CLEANUP_ALARM) cleanupCache().catch(() => {});
  else if (alarm.name === REMINDER_ALARM) runReminder().catch(() => {});
  else onSyncAlarm(alarm.name).catch(() => {});
});
chrome.runtime.onInstalled.addListener(scheduleQuiz);
chrome.runtime.onStartup.addListener(scheduleQuiz);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) scheduleQuiz();
});
scheduleQuiz();

// --- Stored data -------------------------------------------------------------------------------
// Older data is brought up to this version's layout (lib/schema.js) whenever this script starts.

ensureSchema().catch(() => {});

// --- Translation cache -------------------------------------------------------------------------
// Translations nobody asked for in seven days are deleted: once a day by an alarm, and when
// this script starts after a longer pause (lib/translation-cache.js). The vault is not touched.

const scheduleCacheCleanup = () => ensureCacheCleanup().catch(() => {});
chrome.runtime.onInstalled.addListener(scheduleCacheCleanup);
chrome.runtime.onStartup.addListener(scheduleCacheCleanup);
scheduleCacheCleanup();

// --- Synchronisation ---------------------------------------------------------------------------
// The engine (sync/engine.js) is started from here and nowhere else: when the browser starts,
// on its own periodic alarm, a moment after the vault changes, and when the options page asks.
// While synchronisation is switched off none of this does anything, and no alarm is set.

const scheduleSync = () => ensureSyncScheduled().catch(() => {});

chrome.runtime.onInstalled.addListener(scheduleSync);
chrome.runtime.onStartup.addListener(() => {
  scheduleSync();
  syncInBackground('startup').catch(() => {});
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.syncConfig) scheduleSync();
  // the vault, or the days a quiz was done (they travel with it)
  if (Object.keys(changes).some((key) => key.startsWith(ENTRY_PREFIX) || key.startsWith(TOMBSTONE_PREFIX) || key === DAYS_KEY)) vaultChanged().catch(() => {});
});
// Back online while this script happens to be awake: send what was waiting. (When it is
// asleep, the retry alarm does the same a little later.)
globalThis.addEventListener?.('online', () => {
  syncInBackground('retry').catch(() => {});
});
scheduleSync();

// Whatever shows a quiz (the popup, the quiz window, a page with the card) keeps a connection
// open while the quiz is there (shared/dom.js: stayConnected). When the connection breaks with
// a question still open, the place is gone: the popup lost the focus, the window or tab was closed.
const QUIZ_CONNECTION = 'wv:quiz:';
chrome.runtime.onConnect.addListener((port) => {
  if (!port.name.startsWith(QUIZ_CONNECTION) || port.sender?.id !== chrome.runtime.id) return;
  port.onDisconnect.addListener(() => {
    quizPageGone(port.name.slice(QUIZ_CONNECTION.length)).catch(() => {});
  });
});

// The notification that stands in for a quiz when nothing else can show one. The API only
// exists once the user has granted the (optional) permission, which can happen while this
// script is running.
let listeningForNotifications = false;
function listenForNotifications() {
  if (listeningForNotifications || !chrome.notifications) return;
  listeningForNotifications = true;
  chrome.notifications.onClicked.addListener((id) => {
    // the quiz that could not be shown otherwise, or the evening reminder: either opens a quiz
    if (id === NOTIFICATION_ID || id === REMINDER_NOTIFICATION) openFromNotification().catch(() => {});
    if (id === REMINDER_NOTIFICATION) chrome.notifications.clear(REMINDER_NOTIFICATION);
  });
}
listenForNotifications();
chrome.permissions.onAdded.addListener(listenForNotifications);
