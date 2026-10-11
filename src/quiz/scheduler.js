// When a quiz is shown, which word it asks, and what an answer does to that word.
//
// Runs in the background script, which the browser may stop at any moment (a service worker in
// Chrome, an event page in Firefox). Nothing is kept in memory: the time of the next quiz lives
// in chrome.storage.local, the wake-up call is a chrome.alarms alarm, and every start of the
// background script calls ensureScheduled() to put a missing alarm back.
//
// There is one way a quiz gets onto the screen, showQuiz(). The timer calls it when a quiz is
// due; "Test now" calls it with the timer and the conditions left out.

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
/** An alarm that goes off this long before the planned time still counts as "it is time". */
const EARLY_MS = 15_000;
/** How many asked words are remembered, to keep the next question from repeating them. */
const REMEMBERED_QUESTIONS = 5;
/** Limits of the "how often" setting, in minutes. */
export const INTERVAL_MINUTES = Object.freeze({ MIN: 1, MAX: 1440, DEFAULT: 20 });
/** Limits of the "answer timeout" setting, in seconds. */
export const TIMEOUT_SECONDS = Object.freeze({ MIN: 5, MAX: 300, DEFAULT: 30 });

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
 * @property {number} planInterval       The "how often" setting that plan was made with, in
 *                                       minutes; a different setting means the plan is stale.
 * @property {{ at: number, reason: string } | null} lastAttempt
 *   The last time a quiz was due and what came of it: 'shown', or the reason it was not shown.
 * @property {{ at: number } | null} lastShown   The last quiz the timer put on screen.
 * @property {{ at: number, reason: string } | null} lastSkip
 *   The last time a quiz was due and could not be shown, and why.
 * @property {number} roundStartedAt     When the current round of questions began (selection.js).
 * @property {{ at: number, id: string, outcome: string, correct: boolean, quality: number | null } | null} lastAnswer
 * @property {string[]} recent   Ids of the words asked most recently, newest last.
 * @property {number[]} speed    The user's pace: times of recent right answers (learning.js: recordSpeed).
 *                               ASSUMPTION: kept on this device and not synchronised; a phone, a
 *                               trackpad and a mouse give different times for the same knowledge.
 */

/** @returns {Promise<QuizState>} */
export async function getQuizState() {
  const stored = (await chrome.storage.local.get(STATE_KEY))[STATE_KEY];
  const defaults = { sonrakiQuizZamani: 0, planInterval: 0, lastAttempt: null, lastShown: null, lastSkip: null, lastAnswer: null, roundStartedAt: 0, recent: [], speed: [] };
  return { ...defaults, ...(stored && typeof stored === 'object' ? stored : {}) };
}

async function saveQuizState(patch) {
  const state = { ...(await getQuizState()), ...patch };
  await chrome.storage.local.set({ [STATE_KEY]: state });
  return state;
}

/** The "how often" setting as a usable number of minutes. */
export function intervalMinutes(settings) {
  const minutes = Math.round(Number(settings.quizIntervalMinutes));
  return Number.isFinite(minutes) && minutes > 0 ? Math.min(INTERVAL_MINUTES.MAX, Math.max(INTERVAL_MINUTES.MIN, minutes)) : INTERVAL_MINUTES.DEFAULT;
}

/**
 * Sets the wake-up call for the planned time. The alarm repeats: if the background script is
 * stopped in the middle of handling one (so that the next plan is never made), the repeat
 * picks the plan up again one interval later instead of the timer falling silent for good.
 */
async function setAlarm(when, periodInMinutes) {
  const at = Math.max(when, Date.now() + MIN_ALARM_DELAY_MS);
  const existing = await chrome.alarms.get(ALARM_NAME);
  if (existing && Math.abs(existing.scheduledTime - at) < 1000 && existing.periodInMinutes === periodInMinutes) return;
  await chrome.alarms.create(ALARM_NAME, { when: at, periodInMinutes });
}

// The plan is read, changed and written back in several steps, and two things can want to do
// that at the same moment (the alarm that woke the background script up, and the check that
// runs at every start). They take turns, so that neither works with a plan the other has
// already replaced. Only the order is kept here; there is nothing to lose if the script stops.
let turns = Promise.resolve();
function inTurn(task) {
  const result = turns.then(task, task);
  turns = result.catch(() => {});
  return result;
}

/**
 * Makes sure the alarm matches the stored plan. Safe to call at any time and as often as needed:
 * at install, at browser start, whenever the background script wakes up, after a settings change.
 */
export function ensureScheduled() {
  return inTurn(async () => {
    const settings = await getSettings();
    const state = await getQuizState();
    if (!settings.quizEnabled) {
      await chrome.alarms.clear(ALARM_NAME);
      if (state.sonrakiQuizZamani || state.planInterval) await saveQuizState({ sonrakiQuizZamani: 0, planInterval: 0 });
      return;
    }
    const interval = intervalMinutes(settings);
    const now = Date.now();
    let { sonrakiQuizZamani } = state;
    // No plan yet, or one made for another frequency: the frequency that is set now counts
    // from now. (A plan further away than one interval can only come from a changed clock.)
    // ASSUMPTION: after the frequency is changed the first quiz comes one full new interval
    // later, whatever was left of the old one.
    if (!sonrakiQuizZamani || state.planInterval !== interval || sonrakiQuizZamani > now + interval * MINUTE) {
      sonrakiQuizZamani = now + interval * MINUTE;
      await saveQuizState({ sonrakiQuizZamani, planInterval: interval });
    }
    // A time that has already passed (the browser was closed) means "at the next opportunity".
    await setAlarm(sonrakiQuizZamani, interval);
  });
}

/** What the vault offers for a quiz. */
async function vaultStatus() {
  const entries = await listEntries();
  const targetLang = await resolveTargetLanguage();
  const cards = askableCards(entries, targetLang);
  const now = Date.now();
  return { cards, targetLang, total: entries.length, askable: cards.length, meanings: countMeanings(cards), due: cards.filter((card) => isDue(card, now)).length };
}

/** The tab the user is looking at, or the reason there is none. `forced`: any active tab will do. */
async function activeTab(forced) {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab) return { reason: 'no_active_tab' };
  if (forced) return { tab };
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
 * @returns {{ ok: true, question: import('./question.js').Question, roundStartedAt: number } | { ok: false, reason: string }}
 *   `roundStartedAt`: to be stored once the question has really been asked.
 */
function nextQuestion(status, state, { allowNotDue, random }) {
  if (status.askable === 0) return { ok: false, reason: 'no_cards' };
  const now = Date.now();
  const roundStartedAt = state.roundStartedAt || now;
  const skipped = new Set();
  for (;;) {
    const pick = selectCard(status.cards.filter((card) => !skipped.has(card.id)), { now, random, recent: state.recent, allowNotDue, roundStartedAt });
    if (!pick) return { ok: false, reason: skipped.size > 0 || status.meanings < CHOICE_COUNT ? 'not_enough_choices' : 'nothing_due' };
    const question = questionFor(pick.card, status.cards, random);
    if (question) return { ok: true, question, roundStartedAt: pick.newRound ? now : roundStartedAt };
    skipped.add(pick.card.id);
  }
}

const remember = (state, id) => [...state.recent, id].slice(-REMEMBERED_QUESTIONS);

/**
 * How long an unanswered card stays on screen.
 * ASSUMPTION: a timed quiz always has a timeout (there is no "wait forever"), so that a card
 * nobody looks at cannot still be open when the next quiz is due.
 */
function cardTimeoutSeconds(settings) {
  const seconds = Math.round(Number(settings.quizTimeoutSeconds));
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(TIMEOUT_SECONDS.MAX, Math.max(TIMEOUT_SECONDS.MIN, seconds)) : TIMEOUT_SECONDS.DEFAULT;
}

/**
 * Puts a quiz on the screen: picks the word, builds the question and hands it to the page the
 * user is looking at. This is the only way a quiz is shown. Never throws; whatever goes wrong
 * becomes the reason.
 *
 * @param {Object} [options]
 * @param {boolean} [options.forced]  "Test now": the switch, the word count, the dates of the
 *   words and the state of the page (video, typing ...) are not looked at. Only the vault
 *   itself can stand in the way (fewer than four meanings), or there being no page to show it on.
 * @param {() => number} [options.random]
 * @returns {Promise<{ reason: string, question: import('./question.js').Question | null }>}
 *   `reason`: 'shown', or why not.
 */
export async function showQuiz({ forced = false, random } = {}) {
  let reason;
  let question = null;
  try {
    const [settings, status, state] = await Promise.all([getSettings(), vaultStatus(), getQuizState()]);
    reason = forced ? '' : standingReason(settings, status);
    if (!reason) {
      const built = nextQuestion(status, state, { allowNotDue: forced || settings.quizAllowNotDue, random });
      const target = built.ok ? await activeTab(forced) : { reason: built.reason };
      if (target.tab) {
        // Only the page itself knows whether a video is playing or the user is typing.
        const message = { type: 'wv:quiz:show', payload: built.question, timeoutSeconds: cardTimeoutSeconds(settings), force: forced };
        const reply = await chrome.tabs.sendMessage(target.tab.id, message, { frameId: 0 }).catch(() => null);
        // No reply: a page extensions cannot run on (browser pages, the add-on store ...).
        reason = reply?.shown ? 'shown' : reply?.reason || 'page_not_supported';
        if (reply?.shown) {
          question = built.question;
          await saveQuizState({ recent: remember(state, question.id), roundStartedAt: built.roundStartedAt });
        }
      } else {
        reason = target.reason;
      }
    }
  } catch (error) {
    reason = `error: ${String(error?.message || error).slice(0, 120)}`;
  }
  return { reason, question };
}

/**
 * The alarm went off: if a quiz is due, show it, note what happened, and plan the next one.
 * @returns {Promise<string>} 'shown', the reason no quiz was shown, or 'not_due'.
 */
export function runScheduledQuiz() {
  return inTurn(async () => {
    const settings = await getSettings();
    if (!settings.quizEnabled) {
      const now = Date.now();
      await saveQuizState({ sonrakiQuizZamani: 0, planInterval: 0, lastAttempt: { at: now, reason: 'disabled' } });
      await chrome.alarms.clear(ALARM_NAME);
      return 'disabled';
    }
    const interval = intervalMinutes(settings);
    // The stored plan decides, not the alarm: an alarm left over from an older plan only
    // makes sure the right one is set.
    const planned = (await getQuizState()).sonrakiQuizZamani;
    if (planned - Date.now() > EARLY_MS) {
      await setAlarm(planned, interval);
      return 'not_due';
    }

    const { reason } = await showQuiz();
    const now = Date.now();
    // Blocked for the moment: not skipped, tried again shortly. Otherwise the regular interval.
    const wait = TRANSIENT.has(reason) ? Math.min(RETRY_MINUTES, interval) : interval;
    const sonrakiQuizZamani = now + wait * MINUTE;
    const outcome = reason === 'shown' ? { lastShown: { at: now } } : { lastSkip: { at: now, reason } };
    await saveQuizState({ sonrakiQuizZamani, planInterval: interval, lastAttempt: { at: now, reason }, ...outcome });
    await setAlarm(sonrakiQuizZamani, interval);
    return reason;
  });
}

/**
 * "Test now": the same quiz the timer would show, right away. The plan and the record of what
 * the timer did are left alone, so the panel keeps describing the real timer.
 * @returns {Promise<{ ok: true } | { ok: false, reason: string }>}
 */
export async function testQuiz() {
  const { reason } = await showQuiz({ forced: true });
  return reason === 'shown' ? { ok: true } : { ok: false, reason };
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
 * @param {number} [answer.ms]     Time from the choices appearing to the click ('answer' only:
 *                                 how long it took to give up says nothing about the word).
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
    const ms = outcome === 'answer' ? Number(answer.ms) : NaN;
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
    intervalMinutes: intervalMinutes(settings),
    minCards: settings.quizMinCards,
    timeoutSeconds: cardTimeoutSeconds(settings),
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
    /** When the browser will wake the extension up for it (0: no alarm is set). */
    alarmAt: alarm ? alarm.scheduledTime : 0,
    lastAttempt: state.lastAttempt,
    lastShown: state.lastShown,
    lastSkip: state.lastSkip,
    lastAnswer: state.lastAnswer,
  };
}
