// What the user has built up: the days a quiz was done (and the streak they make), and the
// rank that goes with the number of learned words. Pure functions; the storage is in streak.js.
//
// Nothing here is a counter that could go out of step between devices. The streak is worked
// out from a list of days, and two devices' lists merge by taking every day that is in either.

// --- Days -------------------------------------------------------------------------------------

const DAY_FORMAT = /^\d{4}-\d{2}-\d{2}$/;
/** How many days are kept. Longer ago than this does not matter to a streak that is alive. */
export const MAX_DAYS = 730;

const pad = (value) => String(value).padStart(2, '0');

/**
 * The calendar day a moment falls on where the user is: 'YYYY-MM-DD' in local time. A quiz
 * done at 23:59 belongs to that day and one done at 00:01 to the next, wherever UTC's midnight is.
 * @param {number | Date} time
 */
export function localDay(time) {
  const date = new Date(time);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export const isDay = (value) => typeof value === 'string' && DAY_FORMAT.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

/**
 * The day `count` days after (or, negative, before) a day. Done on the calendar, not on the
 * clock, so days that are 23 or 25 hours long (daylight saving) cannot shift the result.
 */
export function addDays(day, count) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

/** A clean list of days: valid, each once, oldest first, no more than the newest MAX_DAYS. */
export function cleanDays(days) {
  return [...new Set((Array.isArray(days) ? days : []).filter(isDay))].sort().slice(-MAX_DAYS);
}

/** Two devices' lists as one: every day that is in either. */
export function mergeDays(a, b) {
  return cleanDays([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])]);
}

// --- Streak -----------------------------------------------------------------------------------

/** A freeze may be used once in this many days. */
export const FREEZE_EVERY_DAYS = 7;

/**
 * The streak that a list of days makes.
 *
 * @param {string[]} days    Days on which the daily quiz was done.
 * @param {string[]} frozen  Days that were missed and covered by a freeze: they keep the streak
 *                           from breaking and are not counted in it.
 * @param {string} today
 * @returns {{ count: number, todayDone: boolean, alive: boolean }}
 *   count: quiz days in the unbroken run that reaches today (or yesterday: the streak is then
 *   still alive and today's quiz would continue it). alive: there is a streak to lose today.
 */
export function streakOf(days, frozen, today) {
  const done = new Set(days);
  const covered = new Set(frozen);
  const todayDone = done.has(today);
  let day = todayDone ? today : addDays(today, -1);
  let count = 0;
  while (done.has(day) || covered.has(day)) {
    if (done.has(day)) count += 1;
    day = addDays(day, -1);
  }
  return { count, todayDone, alive: count > 0 };
}

/** Whether a freeze is to be had: none was used in the last FREEZE_EVERY_DAYS days. */
export function canFreeze(frozen, today) {
  const earliest = addDays(today, -(FREEZE_EVERY_DAYS - 1));
  return !frozen.some((day) => day >= earliest && day <= today);
}

/**
 * The day a freeze would save the streak for, or '' when there is nothing to save.
 * ASSUMPTION: a freeze covers one missed day, yesterday: the browser was not opened, and
 * the day before that there was a streak. A longer gap is not something a freeze repairs.
 */
export function freezeOffer(days, frozen, today) {
  const yesterday = addDays(today, -1);
  if (days.includes(yesterday) || frozen.includes(yesterday)) return '';
  if (!canFreeze(frozen, today)) return '';
  // what the streak was when yesterday began
  const before = streakOf(days, frozen, addDays(yesterday, -1));
  return before.todayDone && before.count > 0 ? yesterday : '';
}

// --- Ranks ------------------------------------------------------------------------------------

/**
 * The ranks, by the number of learned words. This is the one place the thresholds live.
 * Beginner, Middle, Mafya and Boss are the user's own names; the three that fill the gaps are
 * ours. A rank lasts until the next one's `from`. `tone` picks the colours of the badge
 * (shared/progress-ui.js).
 *
 * The thresholds are two thirds of the first ones (100, 200, 300, 500, 1000, 2000), rounded to
 * fives: a word counts as learned only after several right answers spread over days, and at
 * the old pace the first step up took months.
 */
export const RANKS = Object.freeze([
  Object.freeze({ id: 'rookie', from: 0, nameKey: 'rankRookie', tone: 'slate' }),
  Object.freeze({ id: 'beginner', from: 65, nameKey: 'rankBeginner', tone: 'green' }),
  Object.freeze({ id: 'middle', from: 135, nameKey: 'rankMiddle', tone: 'blue' }),
  Object.freeze({ id: 'senior', from: 200, nameKey: 'rankSenior', tone: 'violet' }),
  Object.freeze({ id: 'mafya', from: 335, nameKey: 'rankMafya', tone: 'crimson' }),
  Object.freeze({ id: 'boss', from: 665, nameKey: 'rankBoss', tone: 'gold' }),
  Object.freeze({ id: 'legend', from: 1335, nameKey: 'rankLegend', tone: 'aurora' }),
]);

/**
 * @param {number} learned  How many words are learned.
 * @returns {{ index: number, id: string, nameKey: string, tone: string, learned: number, from: number,
 *   next: { id: string, nameKey: string, from: number } | null, remaining: number, progress: number }}
 *   remaining: words until the next rank (0 at the top). progress: 0..1 through the current rank.
 */
export function rankOf(learned) {
  const count = Number.isFinite(learned) && learned > 0 ? Math.floor(learned) : 0;
  let index = 0;
  for (let i = 0; i < RANKS.length; i++) if (count >= RANKS[i].from) index = i;
  const rank = RANKS[index];
  const next = RANKS[index + 1] || null;
  return {
    index,
    id: rank.id,
    nameKey: rank.nameKey,
    tone: rank.tone,
    learned: count,
    from: rank.from,
    next: next && { id: next.id, nameKey: next.nameKey, from: next.from },
    remaining: next ? next.from - count : 0,
    progress: next ? (count - rank.from) / (next.from - rank.from) : 1,
  };
}
