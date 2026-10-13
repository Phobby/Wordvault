// The days a quiz was done, kept on this device and synchronised with the vault (sync/local.js).
//
// What is stored is a list of calendar days, never a counter: the streak is worked out from
// the list every time (progress.js), and two devices' lists merge by taking every day in
// either. Today's count of answers stays on the device it was made on.

import { addDays, canFreeze, cleanDays, freezeOffer, localDay, mergeDays, streakOf } from './progress.js';

export const DAYS_KEY = 'quizDays';
const TODAY_KEY = 'quizToday';
/** Limits of the "daily goal" setting: how many answered questions make a day count. */
export const DAILY_GOAL = Object.freeze({ MIN: 1, MAX: 50, DEFAULT: 5 });

/** The setting as a usable number. */
export function dailyGoal(settings) {
  const goal = Math.round(Number(settings?.quizDailyGoal));
  return Number.isFinite(goal) && goal > 0 ? Math.min(DAILY_GOAL.MAX, Math.max(DAILY_GOAL.MIN, goal)) : DAILY_GOAL.DEFAULT;
}

/** @returns {Promise<{ days: string[], frozen: string[] }>} Quiz days and days covered by a freeze, oldest first. */
export async function getDays() {
  const stored = (await chrome.storage.local.get(DAYS_KEY))[DAYS_KEY];
  return { days: cleanDays(stored?.days), frozen: cleanDays(stored?.frozen) };
}

async function saveDays({ days, frozen }) {
  await chrome.storage.local.set({ [DAYS_KEY]: { days: cleanDays(days), frozen: cleanDays(frozen) } });
}

/**
 * Days that came from another device: added to this device's. Nothing is ever taken away.
 * @returns {Promise<boolean>} Whether this device learned of a day it did not know.
 */
export async function addRemoteDays(remote) {
  const local = await getDays();
  const merged = { days: mergeDays(local.days, remote?.days), frozen: mergeDays(local.frozen, remote?.frozen) };
  if (merged.days.length === local.days.length && merged.frozen.length === local.frozen.length) return false;
  await saveDays(merged);
  return true;
}

/** How many questions were answered today on this device. */
async function answeredToday(today) {
  const stored = (await chrome.storage.local.get(TODAY_KEY))[TODAY_KEY];
  return stored?.day === today && Number.isFinite(stored.answered) ? stored.answered : 0;
}

/**
 * A question was answered (right, wrong or "I don't know"; not one that was put off or
 * closed). When today's count reaches the goal, today becomes a quiz day.
 * @returns {Promise<{ answered: number, goal: number, todayDone: boolean, completedNow: boolean }>}
 */
export async function countAnswer(now, goal) {
  const today = localDay(now);
  const answered = (await answeredToday(today)) + 1;
  await chrome.storage.local.set({ [TODAY_KEY]: { day: today, answered } });
  const state = await getDays();
  const was = state.days.includes(today);
  const reached = answered >= goal;
  if (reached && !was) await saveDays({ days: [...state.days, today], frozen: state.frozen });
  return { answered, goal, todayDone: was || reached, completedNow: reached && !was };
}

/**
 * Where the streak stands.
 * @param {number} now
 * @param {Object} settings
 * @returns {Promise<{ count: number, todayDone: boolean, alive: boolean, answered: number, goal: number,
 *   freezeDay: string, freezeAvailable: boolean }>}
 *   freezeDay: the missed day a freeze would cover right now ('' if there is nothing to save
 *   or freezing is switched off).
 */
export async function streakStatus(now, settings) {
  const today = localDay(now);
  const { days, frozen } = await getDays();
  const enabled = settings?.quizFreezeEnabled !== false;
  return {
    ...streakOf(days, frozen, today),
    answered: await answeredToday(today),
    goal: dailyGoal(settings),
    freezeDay: enabled ? freezeOffer(days, frozen, today) : '',
    freezeAvailable: enabled && canFreeze(frozen, today),
  };
}

/**
 * Uses the freeze for the day that was missed.
 * @returns {Promise<boolean>} false if there was nothing to freeze (or no freeze to be had).
 */
export async function useFreeze(now, settings) {
  if (settings?.quizFreezeEnabled === false) return false;
  const today = localDay(now);
  const state = await getDays();
  const day = freezeOffer(state.days, state.frozen, today);
  if (!day || day !== addDays(today, -1)) return false;
  await saveDays({ days: state.days, frozen: [...state.frozen, day] });
  return true;
}
