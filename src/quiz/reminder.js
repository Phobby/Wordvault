// The evening reminder: once a day, at a time the user chose, if the day's quiz is not done
// yet. It is a system notification, which needs the optional "notifications" permission; without
// it nothing is shown and everything else works as before.
//
// The background script may be stopped at any time, so nothing is kept in memory: the wake-up
// call is a chrome.alarms alarm, and the day a reminder was last shown is in storage.

import { getSettings } from '../lib/settings.js';
import { notificationsAllowed } from './display.js';
import { localDay } from './progress.js';
import { streakStatus } from './streak.js';

export const REMINDER_ALARM = 'wv:streak:reminder';
export const REMINDER_NOTIFICATION = 'wv:streak';
const STATE_KEY = 'streakReminder';
const LAST_KEY = 'streakReminderLast';
const DEFAULT_TIME = '20:00';

/** 'HH:MM' as minutes since midnight, or null if it is not a time of day. */
export function minutesOf(time) {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(time || '').trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/**
 * The next moment the clock shows `time` where the user is: today if that is still to come,
 * otherwise tomorrow. Built from calendar fields, so a day with a clock change gets the wall
 * clock time it shows, not "24 hours later".
 */
export function nextTimeOfDay(now, time) {
  const minutes = minutesOf(time) ?? minutesOf(DEFAULT_TIME);
  const at = new Date(now);
  at.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  if (at.getTime() <= now) at.setDate(at.getDate() + 1);
  return at.getTime();
}

/**
 * Whether a moment falls into the quiet hours. They may run over midnight ("22:00" to "07:00").
 * Both empty, or equal: there are none.
 */
export function inQuietHours(now, start, end) {
  const from = minutesOf(start);
  const to = minutesOf(end);
  if (from === null || to === null || from === to) return false;
  const date = new Date(now);
  const minute = date.getHours() * 60 + date.getMinutes();
  return from < to ? minute >= from && minute < to : minute >= from || minute < to;
}

/** What the reminder says. Encouraging, not pressing; no word of the vault is in it. */
export function reminderText(count) {
  const t = (key, substitutions) => chrome.i18n.getMessage(key, substitutions);
  return {
    title: t('reminderTitle'),
    message: count > 1 ? t('reminderStreak', [String(count)]) : count === 1 ? t('reminderStreakOne') : t('reminderNoStreak'),
  };
}

/**
 * Keeps the alarm in step with the settings: set for the next time of day while the quiz and
 * the reminder are switched on, gone otherwise. Safe to call at any time.
 */
export async function ensureReminder(now = Date.now()) {
  const settings = await getSettings();
  if (!settings.quizEnabled || settings.quizReminderEnabled === false) {
    await chrome.alarms.clear(REMINDER_ALARM);
    return 0;
  }
  const when = nextTimeOfDay(now, settings.quizReminderTime);
  const existing = await chrome.alarms.get(REMINDER_ALARM);
  if (!existing || Math.abs(existing.scheduledTime - when) > 1000) await chrome.alarms.create(REMINDER_ALARM, { when });
  return when;
}

/**
 * The alarm went off.
 * @returns {Promise<string>} 'shown', or why nothing was shown.
 */
export async function runReminder(now = Date.now()) {
  const settings = await getSettings();
  const decide = async () => {
    if (!settings.quizEnabled) return 'quiz_off';
    if (settings.quizReminderEnabled === false) return 'reminder_off';
    const today = localDay(now);
    if ((await chrome.storage.local.get(STATE_KEY))[STATE_KEY]?.day === today) return 'already_today';
    if (inQuietHours(now, settings.quizQuietStart, settings.quizQuietEnd)) return 'quiet_hours';
    const streak = await streakStatus(now, settings);
    if (streak.todayDone) return 'done_today';
    if (!(await notificationsAllowed())) return 'not_allowed';
    const { title, message } = reminderText(streak.count);
    try {
      await chrome.notifications.create(REMINDER_NOTIFICATION, { type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon-128.png'), title, message });
    } catch {
      return 'refused';
    }
    await chrome.storage.local.set({ [STATE_KEY]: { day: today, at: now } });
    return 'shown';
  };
  const outcome = await decide();
  // what came of it, for the settings page to show (it says nothing about any word)
  await chrome.storage.local.set({ [LAST_KEY]: { at: now, outcome } });
  await ensureReminder(now + 1000); // tomorrow's
  return outcome;
}
