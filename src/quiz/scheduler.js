// When a quiz is shown, which word it asks, and what an answer does to that word.
//
// Runs in the background script, which the browser may stop at any moment (a service worker in
// Chrome, an event page in Firefox). Nothing is kept in memory: the time of the next quiz lives
// in chrome.storage.local, the wake-up call is a chrome.alarms alarm, and every start of the
// background script calls ensureScheduled() to put a missing alarm back.

import { getSettings } from '../lib/settings.js';
import { resolveTargetLanguage } from '../lib/translator.js';
import { getEntry, listEntries, updateEntry } from '../lib/vault.js';
import { applyAnswer, expectedMs, levelOf, postpone, rateAnswer, recordSpeed, statusOf, usualMs } from './learning.js';
import { CHOICE_COUNT, askableCards, countMeanings, questionFor } from './question.js';
import { isDue, selectCard } from './selection.js';

export const ALARM_NAME = 'wv:quiz';
const STATE_KEY = 'quizState';
const MINUTE = 60_000;
/** A quiz that could not be shown right now (video playing, typing ...) is tried again this soon. */
export const RETRY_MINUTES = 3;
/** Browsers do not fire alarms sooner than this after they are created. */
const MIN_ALARM_DELAY_MS = 30_000;
/** How many asked words are remembered, to keep the next question from repeating them. */
const REMEMBERED_QUESTIONS = 5;

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
/** Ways a question can end without an answer: nothing is held against the word.
 *  ASSUMPTION: closing the card counts as "ask later", not as a wrong answer. */
const UNANSWERED = new Set(['later', 'timeout', 'closed']);

/**
 * @typedef {Object} QuizState
 * @property {number} sonrakiQuizZamani  When the next quiz is due (ms since the epoch); 0 = none.
 * @property {{ at: number, reason: string } | null} lastAttempt
 *   The last time a quiz was due and what came of it: 'shown', or the reason it was not shown.
 * @property {{ at: number, id: string, outcome: string, correct: boolean, quality: number | null } | null} lastAnswer
 * @property {string[]} recent   Ids of the words asked most recently, newest last.
 * @property {number[]} speed    The user's pace: times of recent right answers (learning.js: recordSpeed).
 *                               ASSUMPTION: kept on this device and not synchronised; a phone, a
 *                               trackpad and a mouse give different times for the same knowledge.
 */

/** @returns {Promise<QuizState>} */
export async function getQuizState() {
  const stored = (await chrome.storage.local.get(STATE_KEY))[STATE_KEY];
  return { sonrakiQuizZamani: 0, lastAttempt: null, lastAnswer: null, recent: [], speed: [], ...(stored && typeof stored === 'object' ? stored : {}) };
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
  const now = Date.now();
  return { cards, targetLang, total: entries.length, askable: cards.length, meanings: countMeanings(cards), due: cards.filter((card) => isDue(card, now)).length };
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
  if (status.due === 0 && !settings.quizAllowNotDue) return 'nothing_due';
  return '';
}

/**
 * The next question: the word the selection picks (selection.js), with choices for it
 * (question.js). A word for which no fair set of choices exists is passed over.
 * @returns {{ ok: true, question: import('./question.js').Question } | { ok: false, reason: string }}
 */
function nextQuestion(status, state, allowNotDue) {
  if (status.askable === 0) return { ok: false, reason: 'no_cards' };
  const skipped = new Set();
  for (;;) {
    const pick = selectCard(status.cards.filter((card) => !skipped.has(card.id)), { now: Date.now(), recent: state.recent, allowNotDue });
    if (!pick) return { ok: false, reason: skipped.size > 0 || status.meanings < CHOICE_COUNT ? 'not_enough_choices' : 'nothing_due' };
    const question = questionFor(pick.card, status.cards);
    if (question) return { ok: true, question };
    skipped.add(pick.card.id);
  }
}

const remember = (state, id) => [...state.recent, id].slice(-REMEMBERED_QUESTIONS);

/**
 * A quiz is due: show it in the active tab if everything allows it, note what happened, and
 * plan the next one. Never throws; whatever goes wrong becomes the recorded reason.
 * @returns {Promise<string>} 'shown' or the reason it was not shown.
 */
export async function runScheduledQuiz() {
  const settings = await getSettings();
  let reason;
  let asked = null;
  try {
    const status = await vaultStatus();
    const state = await getQuizState();
    reason = standingReason(settings, status);
    if (!reason) {
      const built = nextQuestion(status, state, settings.quizAllowNotDue);
      const target = built.ok ? await activeTab() : { reason: built.reason };
      if (target.tab) {
        // Only the page itself knows whether a video is playing or the user is typing.
        const reply = await chrome.tabs.sendMessage(target.tab.id, { type: 'wv:quiz:show', payload: built.question }, { frameId: 0 }).catch(() => null);
        // No reply: a page extensions cannot run on (browser pages, the add-on store ...).
        reason = reply?.shown ? 'shown' : reply?.reason || 'page_not_supported';
        if (reply?.shown) asked = remember(state, built.question.id);
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
  await saveQuizState({ sonrakiQuizZamani, lastAttempt: { at: now, reason }, ...(asked ? { recent: asked } : {}) });
  await setAlarm(sonrakiQuizZamani);
  return reason;
}

/**
 * A question for "Test now": the timer and every condition are skipped, and a word is asked
 * even if none is due. Only the vault itself can stand in the way (fewer than four meanings).
 */
export async function buildTestQuestion() {
  const [status, state] = await Promise.all([vaultStatus(), getQuizState()]);
  const built = nextQuestion(status, state, true);
  if (built.ok) await saveQuizState({ recent: remember(state, built.question.id) });
  return built;
}

/**
 * What became of a question: the word's statistics and its next date are updated.
 *
 * @param {Object} answer
 * @param {string} answer.id
 * @param {'answer' | 'unknown' | 'later' | 'timeout' | 'closed'} [answer.outcome]
 *   'answer' (the default): a choice was picked; 'unknown': "I don't know", which counts as
 *   wrong; the rest: no answer, the word simply comes back a little later.
 * @param {boolean} [answer.correct]
 * @param {number} [answer.ms]     Time from the choices appearing to the click.
 * @param {number} [answer.chars]  Total length of the choices (Question.chars).
 * @returns {Promise<{ quality: number | null, dueAt: number, status: string } | null>}
 *   null if the word is no longer in the vault.
 */
export async function recordAnswer(answer) {
  const id = String(answer?.id || '');
  const entry = id ? await getEntry(id) : null;
  if (!entry) return null;
  const state = await getQuizState();
  const now = Date.now();
  const outcome = ['unknown', 'later', 'timeout', 'closed'].includes(answer.outcome) ? answer.outcome : 'answer';

  let result;
  let quality = null;
  let speed = state.speed;
  const correct = outcome === 'answer' && answer.correct === true;
  if (UNANSWERED.has(outcome)) {
    result = postpone(entry.quiz, now);
  } else {
    const ms = Number(answer.ms);
    quality = rateAnswer({ correct, ms, unknown: outcome === 'unknown' }, expectedMs(state.speed, answer.chars));
    result = applyAnswer(entry.quiz, { quality, correct, ms }, now, usualMs(state.speed));
    if (correct) speed = recordSpeed(state.speed, ms, answer.chars);
  }
  await updateEntry(id, { quiz: result.stats, dueAt: result.dueAt, box: levelOf(result.stats) });
  await saveQuizState({ speed, lastAnswer: { at: now, id, outcome, correct, quality } });
  return { quality, dueAt: result.dueAt, status: statusOf(result.stats) };
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
    /** Words that are due for review right now (new words included). */
    due: status.due,
    targetLang: status.targetLang,
    /** Why no quiz can come at all ('' if one can). */
    standingReason: standingReason(settings, status),
    nextAt: state.sonrakiQuizZamani,
    alarmAt: alarm ? alarm.scheduledTime : 0,
    lastAttempt: state.lastAttempt,
    lastAnswer: state.lastAnswer,
  };
}
