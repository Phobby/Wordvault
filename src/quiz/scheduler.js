// When a quiz is shown, which word it asks, and what an answer does to that word.
//
// Runs in the background script, which the browser may stop at any moment (a service worker in
// Chrome, an event page in Firefox). Nothing is kept in memory: the time of the next quiz lives
// in chrome.storage.local, the wake-up call is a chrome.alarms alarm, and every start of the
// background script calls ensureScheduled() to put a missing alarm back.
//
// There is one way a quiz gets onto the screen, showQuiz(). The timer calls it when a quiz is
// due; "Test now" calls it with the timer and the conditions left out. How it is put there
// (toolbar popup, window, card on the page, notification) is display.js; the questions of a
// quiz that is on screen are session.js.

import { getSettings } from '../lib/settings.js';
import { resolveTargetLanguage } from '../lib/translator.js';
import { getEntry, listEntries, updateEntry } from '../lib/vault.js';
import { MODES, applyAnswer, expectedMs, levelOf, postpone, rateAnswer, recordSpeed, statusOf, usualMs } from './learning.js';
import { localDay } from './progress.js';
import { countAnswer, dailyGoal } from './streak.js';
import { METHODS, NOTIFICATION_ID, PREFERENCES, display, methodOrder, notificationsAllowed, sessionClaimed } from './display.js';
import { CHOICE_COUNT, askableCards, countMeanings, questionInMode } from './question.js';
import { isDue, selectCard } from './selection.js';
import { clearSession, isOnScreen, newSession, readSession, summaryOf, updateSession, viewOf, writeSession } from './session.js';

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
/** Limits of the "questions per quiz" setting. */
export const QUESTIONS_PER_QUIZ = Object.freeze({ MIN: 1, MAX: 20, DEFAULT: 1 });

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
  'no_display',
]);
/** Ways a question can end without an answer: nothing is held against the word.
 *  ASSUMPTION: closing the card counts as "ask later", not as a wrong answer. */
const UNANSWERED = new Set(['later', 'timeout', 'closed', 'no_voice']);
/** A language found to have no voice is not asked for by ear again for this long (voices get installed, browsers differ). */
const NO_VOICE_MS = 24 * 60 * 60 * 1000;

/**
 * @typedef {Object} QuizState
 * @property {number} sonrakiQuizZamani  When the next quiz is due (ms since the epoch); 0 = none.
 * @property {number} planInterval       The "how often" setting that plan was made with, in
 *                                       minutes; a different setting means the plan is stale.
 * @property {{ at: number, reason: string } | null} lastAttempt
 *   The last time a quiz was due and what came of it: 'shown', or the reason it was not shown.
 * @property {{ at: number, method: string, tried: object[] } | null} lastShown
 *   The last quiz the timer put on screen: in which way, and which ways were tried in vain
 *   before it (display.js).
 * @property {{ at: number, reason: string, tried?: object[] } | null} lastSkip
 *   The last time a quiz was due and could not be shown, and why.
 * @property {number} mutedUntil         "Not today": no quiz before this time (0 = not muted).
 * @property {number} roundStartedAt     When the current round of questions began (selection.js).
 * @property {{ at: number, id: string, outcome: string, correct: boolean, quality: number | null } | null} lastAnswer
 * @property {string[]} recent   Ids of the words asked most recently, newest last.
 * @property {number} modeTurn   Counts questions, for taking the ways of asking in turn.
 * @property {Record<string, number>} noVoice  Languages this device could not say a word in, with the time until which listening is not tried for them.
 * @property {number[]} speed    The user's pace: times of recent right answers (learning.js: recordSpeed).
 *                               ASSUMPTION: kept on this device and not synchronised; a phone, a
 *                               trackpad and a mouse give different times for the same knowledge.
 */

/** @returns {Promise<QuizState>} */
export async function getQuizState() {
  const stored = (await chrome.storage.local.get(STATE_KEY))[STATE_KEY];
  const defaults = { sonrakiQuizZamani: 0, planInterval: 0, mutedUntil: 0, lastAttempt: null, lastShown: null, lastSkip: null, lastAnswer: null, roundStartedAt: 0, recent: [], speed: [], modeTurn: 0, noVoice: {} };
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
      // Switching the quiz off and on again also ends a "not today".
      if (state.sonrakiQuizZamani || state.planInterval || state.mutedUntil) await saveQuizState({ sonrakiQuizZamani: 0, planInterval: 0, mutedUntil: 0 });
      return;
    }
    const interval = intervalMinutes(settings);
    const now = Date.now();
    // "Not today": nothing before tomorrow.
    const earliest = Math.max(now, state.mutedUntil);
    let { sonrakiQuizZamani } = state;
    // No plan yet, or one made for another frequency: the frequency that is set now counts
    // from now. (A plan further away than one interval can only come from a changed clock.)
    // ASSUMPTION: after the frequency is changed the first quiz comes one full new interval
    // later, whatever was left of the old one.
    if (!sonrakiQuizZamani || state.planInterval !== interval || sonrakiQuizZamani > earliest + interval * MINUTE) {
      sonrakiQuizZamani = Math.max(now + interval * MINUTE, state.mutedUntil);
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

/**
 * Where the user is: the browser window in front, its active tab, and what the page in it says
 * about the moment. Or the reason this is no moment for a quiz.
 * `forced` ("Test now"): any active tab will do and the moment is not asked about.
 * @returns {Promise<{ reason: string } | { window: object | null, tab: object, page: boolean }>}
 *   `page`: the page can be talked to, so a card can be shown on it.
 */
async function lookAround(forced) {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab) return { reason: 'no_active_tab' };
  const window = await chrome.windows.get(tab.windowId).catch(() => null);
  if (!forced) {
    if (!window?.focused) return { reason: 'window_not_focused' };
    if (tab.audible) return { reason: 'media_playing' };
  }
  // Only the page itself knows whether a video is playing or the user is typing.
  // ASSUMPTION: a bad moment holds every way of showing the quiz back, the notification
  // included: a popup over a film is as unwelcome as a card, and it would take the keyboard
  // away from someone who is typing.
  const said = await chrome.tabs.sendMessage(tab.id, { type: 'wv:quiz:probe' }, { frameId: 0 }).catch(() => null);
  // No reply: a page extensions cannot run on (browser pages, the add-on store ...). Nothing
  // is known about the moment then, and no card can be shown there.
  if (said?.blocked && !forced) return { reason: said.blocked };
  return { window, tab, page: Boolean(said) };
}

/** Why a quiz cannot be shown at all right now, or '' if nothing stands in the way so far. */
function standingReason(settings, status, state, now) {
  if (!settings.quizEnabled) return 'disabled';
  if (state.mutedUntil > now) return 'muted';
  if (status.total < settings.quizMinCards) return 'below_min_cards';
  // Four meanings are needed wherever there are choices; a quiz that only has words typed needs none.
  if (status.meanings < CHOICE_COUNT && enabledModes(settings).some((mode) => mode !== 'writing')) return 'not_enough_choices';
  if (status.due === 0 && !settings.quizAllowNotDue) return 'nothing_due';
  return '';
}

/**
 * The next question: the word the selection picks (selection.js), with choices for it
 * (question.js). A word for which no fair set of choices exists is passed over.
 * @param {Object} options
 * @param {boolean} options.allowNotDue
 * @param {string[]} [options.exclude]  Ids of words that must not be asked (again).
 * @param {() => number} [options.random]
 * @returns {{ ok: true, question: import('./question.js').Question, roundStartedAt: number } | { ok: false, reason: string }}
 *   `roundStartedAt`: to be stored once the question has really been asked.
 */
function nextQuestion(status, state, { allowNotDue, exclude = [], random, settings = {} }) {
  if (status.askable === 0) return { ok: false, reason: 'no_cards' };
  const now = Date.now();
  const roundStartedAt = state.roundStartedAt || now;
  const skipped = new Set(exclude);
  const mode = pickMode(settings, state, random);
  for (;;) {
    const pick = selectCard(status.cards.filter((card) => !skipped.has(card.id)), { now, random, recent: state.recent, allowNotDue, roundStartedAt });
    if (!pick) return { ok: false, reason: skipped.size > exclude.length || status.meanings < CHOICE_COUNT ? 'not_enough_choices' : 'nothing_due' };
    // A language this device has no voice for is not asked by ear.
    const silent = [String(pick.card.sourceLang || '').toLowerCase(), `id:${pick.card.id}`].some((key) => (state.noVoice?.[key] || 0) > now);
    const question = questionInMode(pick.card, status.cards, mode, random, { listenChoices: settings.quizListenChoices === 'spelling' ? 'spelling' : 'meaning', allowed: enabledModes(settings), without: silent ? ['listening'] : [] });
    if (question) {
      // what the card needs to know from the settings travels with the question
      if (question.mode === 'writing') question.accentTolerant = settings.quizAccentTolerant === true;
      if (question.mode === 'listening') question.autoplay = settings.quizListenAutoplay !== false;
      return { ok: true, question, roundStartedAt: pick.newRound ? now : roundStartedAt };
    }
    skipped.add(pick.card.id);
  }
}

/** The ways of asking that are switched on; the classic way when none is. */
export function enabledModes(settings) {
  const on = MODES.filter((mode) => settings[{ classic: 'quizModeClassic', writing: 'quizModeWriting', listening: 'quizModeListening' }[mode]] === true);
  return on.length > 0 ? on : ['classic'];
}

/**
 * How the next word is asked: one of the ways that are switched on, at random when they are
 * mixed, otherwise each in its turn.
 */
export function pickMode(settings, state, random = Math.random) {
  const modes = enabledModes(settings);
  if (modes.length === 1) return modes[0];
  if (settings.quizModeMixed !== false) return modes[Math.floor(random() * modes.length)];
  return modes[(Number(state.modeTurn) || 0) % modes.length];
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

/** How many questions one quiz asks. */
function questionsPerQuiz(settings) {
  const count = Math.round(Number(settings.quizQuestionsPerQuiz));
  return Number.isFinite(count) && count > 0 ? Math.min(QUESTIONS_PER_QUIZ.MAX, Math.max(QUESTIONS_PER_QUIZ.MIN, count)) : QUESTIONS_PER_QUIZ.DEFAULT;
}

const displayPreference = (settings) => (PREFERENCES.includes(settings.quizDisplay) ? settings.quizDisplay : 'auto');

/**
 * Puts a quiz on the screen: picks the word, builds the question and shows it in the first way
 * that works (display.js). This is the only way a quiz is shown. Never throws; whatever goes
 * wrong becomes the reason.
 *
 * @param {Object} [options]
 * @param {boolean} [options.forced]  "Test now": the switch, the word count, the dates of the
 *   words, "not today" and the state of the page (video, typing ...) are not looked at. Only
 *   the vault itself can stand in the way (fewer than four meanings), or there being no way
 *   to show it.
 * @param {string[]} [options.methods]  The ways to try instead of the ones the settings say.
 * @param {() => number} [options.random]
 * @returns {Promise<{ reason: string, method: string, tried: { method: string, reason: string, detail?: string }[] }>}
 *   `reason`: 'shown', or why not. `method`: the way it is shown. `tried`: the ways that did
 *   not work, in the order they were tried.
 */
export async function showQuiz({ forced = false, methods, random } = {}) {
  let reason;
  let method = '';
  let tried = [];
  try {
    const [settings, status, state, running] = await Promise.all([getSettings(), vaultStatus(), getQuizState(), readSession()]);
    const now = Date.now();
    reason = forced ? '' : standingReason(settings, status, state, now);
    // One quiz at a time. ("Test now" takes the place of whatever is there.)
    if (!reason && !forced && isOnScreen(running, now)) reason = 'already_showing';
    if (!reason) {
      const built = nextQuestion(status, state, { allowNotDue: forced || settings.quizAllowNotDue, random, settings });
      const scene = built.ok ? await lookAround(forced) : { reason: built.reason };
      reason = scene.reason || '';
      if (!reason) {
        // A quiz this one takes the place of may have left its window open.
        if (running?.windowId) await chrome.windows.remove(running.windowId).catch(() => {});
        const session = await writeSession(newSession({ question: built.question, total: questionsPerQuiz(settings), forced, timeoutSeconds: cardTimeoutSeconds(settings), now }));
        ({ method, tried } = await display(session, scene, { methods: methods || methodOrder(displayPreference(settings)), forced }));
        if (method) {
          reason = 'shown';
          await updateSession(session.id, { method });
          await saveQuizState({ recent: remember(state, built.question.id), roundStartedAt: built.roundStartedAt, modeTurn: (Number(state.modeTurn) || 0) + 1 });
        } else {
          reason = 'no_display';
          if ((await readSession())?.id === session.id) await clearSession();
        }
      }
    }
  } catch (error) {
    reason = `error: ${String(error?.message || error).slice(0, 120)}`;
  }
  return { reason, method, tried };
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
      await saveQuizState({ sonrakiQuizZamani: 0, planInterval: 0, mutedUntil: 0, lastAttempt: { at: now, reason: 'disabled' } });
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

    const { reason, method, tried } = await showQuiz();
    const now = Date.now();
    // Blocked for the moment: not skipped, tried again shortly. Otherwise the regular interval.
    const wait = TRANSIENT.has(reason) ? Math.min(RETRY_MINUTES, interval) : interval;
    const sonrakiQuizZamani = now + wait * MINUTE;
    const outcome = reason === 'shown' ? { lastShown: { at: now, method, tried } } : { lastSkip: { at: now, reason, ...(tried.length > 0 ? { tried } : {}) } };
    await saveQuizState({ sonrakiQuizZamani, planInterval: interval, lastAttempt: { at: now, reason }, ...outcome });
    await setAlarm(sonrakiQuizZamani, interval);
    return reason;
  });
}

/**
 * "Test now": the same quiz the timer would show, right away and in the same way. The plan and
 * the record of what the timer did are left alone, so the panel keeps describing the real timer.
 * @param {{ methods?: string[] }} [options]  Try only these ways (the settings page uses this
 *   to let the notification be seen, which otherwise only comes when nothing else works).
 * @returns {Promise<{ ok: boolean, reason: string, method: string, tried: object[] }>}
 */
export async function testQuiz(options) {
  const methods = Array.isArray(options?.methods) ? options.methods.filter((method) => METHODS.includes(method)) : [];
  const shown = await showQuiz({ forced: true, ...(methods.length > 0 ? { methods } : {}) });
  return { ok: shown.reason === 'shown', ...shown };
}

/** The notification that stood in for a quiz was clicked: the quiz opens, in a window. */
export async function openFromNotification() {
  await chrome.notifications?.clear(NOTIFICATION_ID);
  return showQuiz({ forced: true, methods: ['window', 'popup', 'card'] });
}

// --- The quiz on screen --------------------------------------------------------------------------

/**
 * A quiz page (the toolbar popup or the quiz window) has loaded and asks what to show.
 * @param {{ surface: 'popup' | 'window' }} payload
 * @returns {Promise<object | null>} What to show (session.js: viewOf), or null if there is no
 *   quiz for this page: none is waiting, it is already shown, or the way this page belongs to
 *   was given up on in the meantime.
 */
export async function claimSession(payload) {
  const session = await readSession();
  if (!session || !session.question || session.claimed || session.offeredTo !== payload?.surface) return null;
  const claimed = await writeSession({ ...session, claimed: true, touchedAt: Date.now() });
  sessionClaimed(claimed.id);
  return viewOf(claimed);
}

/**
 * What became of the question on screen: it is recorded (recordAnswer), and the reply says what
 * the place showing the quiz does next.
 *
 * @param {Object} answer  As for recordAnswer, plus `sessionId`.
 * @returns {Promise<{ next: { question: object, index: number } | null, summary: object | null }>}
 *   `next`: the following question of the same quiz. `summary`: the quiz is over and asked more
 *   than one question (session.js: summaryOf). Neither: there is nothing more to show.
 */
export async function answerQuestion(answer) {
  await recordAnswer(answer);
  const session = await readSession();
  // An answer from a card that is no longer the current quiz is recorded and nothing more.
  if (!session || session.id !== answer?.sessionId || session.question?.id !== answer.id) return { next: null, summary: null };

  const outcome = outcomeOf(answer);
  const counted = !UNANSWERED.has(outcome);
  // A word that could not be said aloud was not really asked: another takes its place.
  const replaced = outcome === 'no_voice';
  const asked = replaced ? session.asked.slice(0, -1) : session.asked;
  const after = {
    ...session,
    asked,
    question: null,
    answered: session.answered + (counted ? 1 : 0),
    right: session.right + (outcome === 'answer' && answer.correct === true ? 1 : 0),
    skipped: session.skipped + (outcome === 'later' ? 1 : 0),
    touchedAt: Date.now(),
  };
  const over = outcome === 'timeout' || outcome === 'closed' || asked.length >= session.total;
  if (!over) {
    const [settings, status, state] = await Promise.all([getSettings(), vaultStatus(), getQuizState()]);
    const built = nextQuestion(status, state, { allowNotDue: session.forced || settings.quizAllowNotDue, exclude: session.asked, settings });
    if (built.ok) {
      const next = await writeSession({ ...after, question: built.question, asked: [...asked, built.question.id] });
      await saveQuizState({ recent: remember(state, built.question.id), roundStartedAt: built.roundStartedAt, modeTurn: (Number(state.modeTurn) || 0) + 1 });
      return { next: { question: next.question, index: next.asked.length }, summary: null };
    }
  }
  await clearSession();
  const finished = outcome !== 'timeout' && outcome !== 'closed';
  return { next: null, summary: finished && session.total > 1 ? summaryOf(after) : null };
}

/**
 * The place that showed a quiz is gone (its connection broke: the popup lost the focus, the
 * window or the tab was closed). If its question was still open, that counts as closing it.
 */
export async function quizPageGone(sessionId) {
  const session = await readSession();
  if (!session || session.id !== sessionId) return; // that quiz ended in the ordinary way
  if (session.question) await answerQuestion({ sessionId, id: session.question.id, outcome: 'closed' });
  else await clearSession();
}

/** The start of the next day, local time. */
function tomorrow(now) {
  const date = new Date(now);
  date.setHours(24, 0, 0, 0);
  return date.getTime();
}

/**
 * "Not today": the quiz on screen is over and no other comes before tomorrow.
 * ASSUMPTION: "today" ends at midnight, local time. The first quiz of the new day comes at the
 * time that was planned anyway, or right after midnight if that time is earlier.
 */
export function muteToday() {
  return inTurn(async () => {
    const now = Date.now();
    const mutedUntil = tomorrow(now);
    await clearSession();
    const settings = await getSettings();
    if (!settings.quizEnabled) {
      await saveQuizState({ mutedUntil });
      return { mutedUntil };
    }
    const interval = intervalMinutes(settings);
    const sonrakiQuizZamani = Math.max(mutedUntil, (await getQuizState()).sonrakiQuizZamani);
    await saveQuizState({ mutedUntil, sonrakiQuizZamani, planInterval: interval });
    await setAlarm(sonrakiQuizZamani, interval);
    return { mutedUntil };
  });
}

/** Takes "not today" back: quizzes come again, the first one an interval from now. */
export async function unmute() {
  await saveQuizState({ mutedUntil: 0, sonrakiQuizZamani: 0 });
  await ensureScheduled();
}

/** The way a question ended, as one of the five known outcomes. */
const outcomeOf = (answer) => (['unknown', 'later', 'timeout', 'closed', 'no_voice'].includes(answer?.outcome) ? answer.outcome : 'answer');

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
  const outcome = outcomeOf(answer);

  let result;
  let quality = null;
  let speed = state.speed;
  let day = null;
  const correct = outcome === 'answer' && answer.correct === true;
  const mode = MODES.includes(answer.mode) ? answer.mode : 'classic';
  const hints = Math.max(0, Math.floor(Number(answer.hints) || 0));
  if (UNANSWERED.has(outcome)) {
    result = postpone(entry.quiz, now);
    // This device could not say the word: its language is left out of listening for a day.
    // (Where recordings stand in for the voice, it is this word that has none, not the language.)
    if (outcome === 'no_voice') {
      const key = answer.scope === 'word' ? `id:${id}` : String(entry.sourceLang || '').toLowerCase();
      const fresh = Object.entries(state.noVoice || {}).filter(([, until]) => until > now).slice(-200);
      if (key) state.noVoice = { ...Object.fromEntries(fresh), [key]: now + NO_VOICE_MS };
    }
  } else {
    const settings = await getSettings();
    const ms = outcome === 'answer' ? Number(answer.ms) : NaN;
    quality = qualityOf({ correct, ms, unknown: outcome === 'unknown', mode, hints, letters: Number(answer.letters) || 0 }, expectedMs(state.speed, answer.chars));
    result = applyAnswer(entry.quiz, { quality, correct, ms: mode === 'classic' ? ms : NaN, mode, hinted: hints > 0 }, now, usualMs(state.speed), {
      day: localDay(now),
      learnedStreak: learnedStreak(settings),
      requireOtherMode: settings.quizLearnedNeedsOtherMode !== false,
    });
    // The user's pace is that of picking one of four; typing and listening take their own time.
    if (correct && mode === 'classic') speed = recordSpeed(state.speed, ms, answer.chars);
    // An answered question counts towards the day, whatever the answer was.
    day = await countAnswer(now, dailyGoal(settings));
  }
  await updateEntry(id, { quiz: result.stats, dueAt: result.dueAt, box: levelOf(result.stats) });
  await saveQuizState({ speed, noVoice: state.noVoice, lastAnswer: { at: now, id, outcome, correct, quality } });
  return { quality, dueAt: result.dueAt, status: statusOf(result.stats), ...(result.learnedNow ? { learnedNow: true } : {}), ...(result.unlearned ? { unlearned: true } : {}), ...(day?.completedNow ? { dayCompleted: true } : {}) };
}

/** Limits of the "right answers in a row" setting. */
export const LEARNED_STREAK = Object.freeze({ MIN: 3, MAX: 20, DEFAULT: 5 });

function learnedStreak(settings) {
  const count = Math.round(Number(settings.quizLearnedStreak));
  return Number.isFinite(count) && count > 0 ? Math.min(LEARNED_STREAK.MAX, Math.max(LEARNED_STREAK.MIN, count)) : LEARNED_STREAK.DEFAULT;
}

/**
 * The quality of an answer (0-5, learning.js: rateAnswer) by how the word was asked.
 *   classic    judged by speed, as always;
 *   listening  right is 4: how long the word took to be said and heard is not the user's speed;
 *   writing    right is 4; with a hint it is "partly right": 3, and 2 (asked again soon) once
 *              half of the letters or more were given away.
 * ASSUMPTION: typing speed is not judged: it measures the keyboard, not the memory.
 */
export function qualityOf({ correct, ms, unknown, mode, hints = 0, letters = 0 }, expected) {
  if (mode === 'classic') return rateAnswer({ correct, ms, unknown }, expected);
  if (unknown) return 0;
  if (!correct) return 1;
  if (hints > 0) return letters > 0 && hints * 2 >= letters ? 2 : 3;
  return 4;
}

/** Everything the "Why is there no quiz?" panel shows. */
export async function getDiagnostics() {
  const [settings, state, status, alarm, notifications] = await Promise.all([getSettings(), getQuizState(), vaultStatus(), chrome.alarms.get(ALARM_NAME), notificationsAllowed()]);
  const now = Date.now();
  return {
    enabled: settings.quizEnabled,
    intervalMinutes: intervalMinutes(settings),
    minCards: settings.quizMinCards,
    timeoutSeconds: cardTimeoutSeconds(settings),
    questionsPerQuiz: questionsPerQuiz(settings),
    /** The chosen way of showing a quiz, and the order in which the ways are tried. */
    display: displayPreference(settings),
    displayOrder: methodOrder(displayPreference(settings)),
    /** Whether a system notification may stand in when nothing else works. */
    notifications,
    /** "Not today" is in force until then (0: it is not). */
    mutedUntil: state.mutedUntil > now ? state.mutedUntil : 0,
    neededMeanings: CHOICE_COUNT,
    total: status.total,
    askable: status.askable,
    meanings: status.meanings,
    /** Words that are due for review right now (new words included). */
    due: status.due,
    targetLang: status.targetLang,
    /** Why no quiz can come at all ('' if one can). */
    standingReason: standingReason(settings, status, state, now),
    nextAt: state.sonrakiQuizZamani,
    /** When the browser will wake the extension up for it (0: no alarm is set). */
    alarmAt: alarm ? alarm.scheduledTime : 0,
    lastAttempt: state.lastAttempt,
    lastShown: state.lastShown,
    lastSkip: state.lastSkip,
    lastAnswer: state.lastAnswer,
  };
}
