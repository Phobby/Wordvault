// When a quiz is shown, and why not.
//
// Runs in the background script, which the browser may stop at any moment (a service worker in
// Chrome, an event page in Firefox). Nothing is kept in memory: the time of the next quiz lives
// in chrome.storage.local, the wake-up call is a chrome.alarms alarm, and every start of the
// background script calls ensureScheduled() to put a missing alarm back.

import { resolveTargetLanguage } from '../lib/translator.js';
import { getSettings } from '../lib/settings.js';
import { listEntries } from '../lib/vault.js';
import { CHOICE_COUNT, askableCards, buildQuestion, countMeanings } from './question.js';

export const ALARM_NAME = 'wv:quiz';
const STATE_KEY = 'quizState';
const MINUTE = 60_000;
/** A quiz that could not be shown right now (video playing, typing ...) is tried again this soon. */
export const RETRY_MINUTES = 3;
/** Browsers do not fire alarms sooner than this after they are created. */
const MIN_ALARM_DELAY_MS = 30_000;

/** Outcomes that are about this moment only; anything else waits for the regular interval. */
const TRANSIENT = new Set([
  'no_active_tab',
  'window_not_focused',
  'tab_hidden',
  'media_playing',
  'video_playing',
  'fullscreen',
  'typing',
  'popup_open',
  'already_showing',
  'page_not_supported',
]);

/**
 * @typedef {Object} QuizState
 * @property {number} sonrakiQuizZamani  When the next quiz is due (ms since the epoch); 0 = none.
 * @property {{ at: number, reason: string } | null} lastAttempt
 *   The last time a quiz was due and what came of it: 'shown', or the reason it was not shown.
 * @property {{ at: number, id: string, correct: boolean } | null} lastAnswer
 */

/** @returns {Promise<QuizState>} */
export async function getQuizState() {
  const stored = (await chrome.storage.local.get(STATE_KEY))[STATE_KEY];
  return { sonrakiQuizZamani: 0, lastAttempt: null, lastAnswer: null, ...(stored && typeof stored === 'object' ? stored : {}) };
}

async function saveQuizState(patch) {
  const state = { ...(await getQuizState()), ...patch };
  await chrome.storage.local.set({ [STATE_KEY]: state });
  return state;
}

async function setAlarm(when) {
  const at = Math.max(when, Date.now() + MIN_ALARM_DELAY_MS);
  const existing = await chrome.alarms.get(ALARM_NAME);
  if (existing && Math.abs(existing.scheduledTime - at) < 1000) return;
  await chrome.alarms.create(ALARM_NAME, { when: at });
}

/**
 * Makes sure the alarm matches the stored plan. Safe to call at any time and as often as needed:
 * at install, at browser start, whenever the background script wakes up, after a settings change.
 */
export async function ensureScheduled() {
  const settings = await getSettings();
  if (!settings.quizEnabled) {
    await chrome.alarms.clear(ALARM_NAME);
    if ((await getQuizState()).sonrakiQuizZamani) await saveQuizState({ sonrakiQuizZamani: 0 });
    return;
  }
  let { sonrakiQuizZamani } = await getQuizState();
  if (!sonrakiQuizZamani) {
    sonrakiQuizZamani = Date.now() + settings.quizIntervalMinutes * MINUTE;
    await saveQuizState({ sonrakiQuizZamani });
  }
  // A time that has already passed (the browser was closed) means "at the next opportunity".
  await setAlarm(sonrakiQuizZamani);
}

/** What the vault offers for a quiz. */
async function vaultStatus() {
  const entries = await listEntries();
  const targetLang = await resolveTargetLanguage();
  const cards = askableCards(entries, targetLang);
  return { entries, targetLang, total: entries.length, askable: cards.length, meanings: countMeanings(cards) };
}

/** The tab the user is looking at, or the reason there is none. */
async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab) return { reason: 'no_active_tab' };
  const window = await chrome.windows.get(tab.windowId).catch(() => null);
  if (!window?.focused) return { reason: 'window_not_focused' };
  if (tab.audible) return { reason: 'media_playing' };
  return { tab };
}

/** Why a quiz cannot be shown at all right now, or '' if nothing stands in the way so far. */
function standingReason(settings, status) {
  if (!settings.quizEnabled) return 'disabled';
  if (status.total < settings.quizMinCards) return 'below_min_cards';
  if (status.meanings < CHOICE_COUNT) return 'not_enough_choices';
  return '';
}

/**
 * A quiz is due: show it in the active tab if everything allows it, note what happened, and
 * plan the next one. Never throws; whatever goes wrong becomes the recorded reason.
 * @returns {Promise<string>} 'shown' or the reason it was not shown.
 */
export async function runScheduledQuiz() {
  const settings = await getSettings();
  let reason;
  try {
    const status = await vaultStatus();
    reason = standingReason(settings, status);
    if (!reason) {
      const built = buildQuestion(status.entries, status.targetLang);
      const target = built.ok ? await activeTab() : { reason: built.reason };
      if (target.tab) {
        // Only the page itself knows whether a video is playing or the user is typing.
        const reply = await chrome.tabs.sendMessage(target.tab.id, { type: 'wv:quiz:show', payload: built.question }, { frameId: 0 }).catch(() => null);
        // No reply: a page extensions cannot run on (browser pages, the add-on store ...).
        reason = reply?.shown ? 'shown' : reply?.reason || 'page_not_supported';
      } else {
        reason = target.reason;
      }
    }
  } catch (error) {
    reason = `error: ${String(error?.message || error).slice(0, 120)}`;
  }

  const now = Date.now();
  if (reason === 'disabled') {
    await saveQuizState({ sonrakiQuizZamani: 0, lastAttempt: { at: now, reason } });
    await chrome.alarms.clear(ALARM_NAME);
    return reason;
  }
  // Blocked for the moment: not skipped, tried again shortly. Otherwise the regular interval.
  const wait = TRANSIENT.has(reason) ? Math.min(RETRY_MINUTES, settings.quizIntervalMinutes) : settings.quizIntervalMinutes;
  const sonrakiQuizZamani = now + wait * MINUTE;
  await saveQuizState({ sonrakiQuizZamani, lastAttempt: { at: now, reason } });
  await setAlarm(sonrakiQuizZamani);
  return reason;
}

/**
 * A question for "Test now": the timer and every condition are skipped. Only the vault itself
 * can stand in the way (fewer than four different meanings).
 */
export async function buildTestQuestion() {
  const status = await vaultStatus();
  return buildQuestion(status.entries, status.targetLang);
}

export async function recordAnswer(answer) {
  await saveQuizState({ lastAnswer: { at: Date.now(), id: String(answer?.id || ''), correct: answer?.correct === true } });
}

/** Everything the "Why is there no quiz?" panel shows. */
export async function getDiagnostics() {
  const [settings, state, status, alarm] = await Promise.all([getSettings(), getQuizState(), vaultStatus(), chrome.alarms.get(ALARM_NAME)]);
  return {
    enabled: settings.quizEnabled,
    intervalMinutes: settings.quizIntervalMinutes,
    minCards: settings.quizMinCards,
    neededMeanings: CHOICE_COUNT,
    total: status.total,
    askable: status.askable,
    meanings: status.meanings,
    targetLang: status.targetLang,
    /** Why no quiz can come at all ('' if one can). */
    standingReason: standingReason(settings, status),
    nextAt: state.sonrakiQuizZamani,
    alarmAt: alarm ? alarm.scheduledTime : 0,
    lastAttempt: state.lastAttempt,
    lastAnswer: state.lastAnswer,
  };
}
