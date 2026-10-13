// How Wordvault follows what the user knows. Every answer is rated by whether it was right and
// how fast it came; the rating decides how long the word stays away before it is asked again.
//
// It is SM-2 (the classic spaced-repetition scheme) with two additions: the answer's quality is
// derived from correctness and speed instead of being asked from the user, and speed is judged
// against the user's own pace. Every number that shapes the behaviour is in TUNING.

const MINUTE = 60_000;

export const TUNING = Object.freeze({
  // --- Ease: how quickly the gaps between reviews of a word grow ------------------------------
  EASE_START: 2.5,
  EASE_MIN: 1.3,
  EASE_MAX: 3,
  /** Change of the ease per answer quality. 3, 4 and 5 are SM-2's own values. */
  EASE_CHANGE: Object.freeze({ 0: -0.2, 1: -0.2, 2: -0.15, 3: -0.14, 4: 0, 5: 0.1 }),

  // --- Gaps -----------------------------------------------------------------------------------
  /** A wrong or hesitant answer sends the word back to learning: it is asked again this soon,
   *  and not before a few other questions (selection.js: RECENT_QUESTIONS). */
  RELEARN_MINUTES: 10,
  /** Gaps after the first right answers: 10 minutes, 1 day, 3 days, 7 days. Beyond the last
   *  one, each gap is the previous one multiplied by the ease. */
  LADDER_MINUTES: Object.freeze([10, 1440, 4320, 10_080]),
  /** The speed of a right answer stretches or shrinks the next gap: slow, normal, fast. */
  SPEED_FACTOR: Object.freeze({ 3: 0.6, 4: 1, 5: 1.4 }),
  MAX_GAP_MINUTES: 365 * 1440,
  /** "Ask later" and a question left unanswered cost nothing; the word returns this soon. */
  POSTPONE_MINUTES: 10,

  // --- Speed ----------------------------------------------------------------------------------
  /** Expected answer time before the user's own pace is known. */
  EXPECTED_MS_START: 4000,
  EXPECTED_MS_MIN: 1500,
  EXPECTED_MS_MAX: 15_000,
  /** The user's pace is the median of this many recent right answers ... */
  SPEED_WINDOW: 25,
  /** ... once there are at least this many of them. */
  SPEED_MIN_SAMPLES: 5,
  /** Choices adding up to this many characters take the expected time; longer ones take
   *  proportionally longer to read, up to LENGTH_FACTOR_MAX times as long. */
  REFERENCE_CHARS: 40,
  LENGTH_FACTOR_MAX: 2.5,
  /** A right answer is fast below 0.6x the expected time, slow above 1.6x, and above 3x it is
   *  hesitation or a guess. */
  FAST_BELOW: 0.6,
  SLOW_ABOVE: 1.6,
  HESITANT_ABOVE: 3,
  /** Anything longer was not spent thinking about the answer. */
  RESPONSE_MS_CAP: 60_000,
  /** Weight of the newest answer in a word's average answer time (exponential moving average). */
  MEAN_WEIGHT: 0.3,

  // --- Difficulty (0 easy .. 1 hard) and status -----------------------------------------------
  /** Share of the error rate, the lost ease and the slowness in the difficulty score. */
  DIFFICULTY_WEIGHTS: Object.freeze({ errors: 0.6, ease: 0.25, slowness: 0.15 }),
  /** "Hard": answered at least this often and still this difficult, or failed this many times. */
  HARD_MIN_ATTEMPTS: 4,
  HARD_DIFFICULTY: 0.6,
  HARD_LAPSES: 3,

  // --- The three ways of asking ---------------------------------------------------------------
  /**
   * How much a right answer is worth, by how it was asked: the gap that follows is multiplied
   * by this. Typing the word is recall, picking it from four is recognition; hearing it sits
   * in between.
   */
  MODE_FACTOR: Object.freeze({ classic: 1, listening: 1.15, writing: 1.35 }),

  // --- "Learned" ------------------------------------------------------------------------------
  /** This many right answers in a row ... (the setting quizLearnedStreak overrides it) */
  LEARNED_STREAK: 5,
  /** ... given on at least this many different calendar days ... */
  LEARNED_DAYS: 3,
  /** ... make a word learned. It is then asked this rarely, at the least. */
  LEARNED_MIN_GAP_MINUTES: 30 * 1440,
  /** How many of the days of a run are remembered (more than LEARNED_DAYS are never needed). */
  RUN_DAYS_KEPT: 5,
});

export const MODES = Object.freeze(['classic', 'writing', 'listening']);
/** The letter a mode's counters are kept under: c1/c0, w1/w0, l1/l0 (right/wrong). */
const MODE_LETTER = Object.freeze({ classic: 'c', writing: 'w', listening: 'l' });

/**
 * What is kept about a word's history. Stored with the word (vault entry `quiz`) and
 * synchronised with it, hence the short keys. There is no log of answers, only this summary.
 *
 * ASSUMPTION: two values beyond the ones the specification lists are kept: the number of right
 * answers (k), because a hesitant right answer breaks the run without being a lapse, so the
 * error rate cannot be derived from the others; and the current gap (i), which SM-2 needs to
 * compute the next one.
 *
 * @typedef {Object} CardStats
 * @property {number} a  Answers given.
 * @property {number} k  Right answers.
 * @property {number} s  Current run of right answers.
 * @property {number} e  Ease.
 * @property {number} i  Current gap in minutes (0 = never answered).
 * @property {number} l  Lapses: wrong answers.
 * @property {number} m  Average answer time in ms (0 = none measured).
 * @property {number} d  Difficulty, 0 to 1.
 * @property {number} x  When the word was last answered (ms since the epoch; 0 = never). A
 *                       question that was postponed or left unanswered does not count.
 *
 * Since schema 2 (learned state and the three ways of asking; all plain values, so that a
 * version that does not know them carries them along unchanged):
 * @property {number} n  Right answers in a row, in whatever way they were asked.
 * @property {string} y  The calendar days of that run: 'YYYY-MM-DD,YYYY-MM-DD', each once.
 * @property {number} o  How many answers of that run were typed or heard (not picked from four).
 * @property {number} g  When the word became learned (ms since the epoch; 0 = it is not).
 * @property {number} c1 @property {number} c0  Right / wrong answers when asked the classic way.
 * @property {number} w1 @property {number} w0  ... when the word had to be typed.
 * @property {number} l1 @property {number} l0  ... when the word was heard.
 */

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const STAT_KEYS = new Set(['a', 'k', 's', 'e', 'i', 'l', 'm', 'd', 'x', 'n', 'y', 'o', 'g', 'c1', 'c0', 'w1', 'w0', 'l1', 'l0']);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** The days of a run from their stored form: valid ones, each once, in order, the newest few. */
const runDays = (value) => [...new Set(String(value || '').split(',').filter((day) => DAY.test(day)))].sort().slice(-TUNING.RUN_DAYS_KEPT);
const round = (value, digits) => Number(value.toFixed(digits));
const count = (value) => (Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);

/** @returns {CardStats} */
export function newStats() {
  return { a: 0, k: 0, s: 0, e: TUNING.EASE_START, i: 0, l: 0, m: 0, d: 0, x: 0 };
}

/**
 * A well-formed CardStats from stored or untrusted data (an imported file, another device).
 * @param {unknown} raw
 * @param {{ keepUnknown?: boolean }} [options]  Keep simple values under keys this version does
 *   not know (data synchronised from a newer version must survive the round trip).
 * @returns {CardStats | null} null if there is nothing usable.
 */
export function normalizeStats(raw, { keepUnknown = false } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const a = count(raw.a);
  const unknown = keepUnknown ? Object.fromEntries(Object.entries(raw).filter(([key, value]) => !STAT_KEYS.has(key) && ['number', 'string', 'boolean'].includes(typeof value))) : {};
  const stats = {
    ...unknown,
    a,
    k: Math.min(a, count(raw.k)),
    s: Math.min(a, count(raw.s)),
    e: Number.isFinite(raw.e) ? round(clamp(raw.e, TUNING.EASE_MIN, TUNING.EASE_MAX), 2) : TUNING.EASE_START,
    i: Math.min(TUNING.MAX_GAP_MINUTES, count(raw.i)),
    l: Math.min(a, count(raw.l)),
    m: Math.min(TUNING.RESPONSE_MS_CAP, count(raw.m)),
    d: Number.isFinite(raw.d) ? round(clamp(raw.d, 0, 1), 2) : 0,
    x: count(raw.x),
  };
  // The fields of schema 2 are only there when they say something: a word that was never
  // typed carries no "typed" counters, on the device or on its way between devices. Data
  // written before schema 2 has none of them, which reads as: no run yet, not learned.
  const later = { n: Math.min(a, count(raw.n)), y: runDays(raw.y).join(','), o: Math.min(a, count(raw.o)), g: count(raw.g), c1: count(raw.c1), c0: count(raw.c0), w1: count(raw.w1), w0: count(raw.w0), l1: count(raw.l1), l0: count(raw.l0) };
  for (const [key, value] of Object.entries(later)) if (value) stats[key] = value;
  return stats.a === 0 && stats.x === 0 ? null : stats;
}

// --- Speed -------------------------------------------------------------------------------------

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** How much longer than usual a question takes to read, from the length of its choices. */
export function lengthFactor(chars) {
  return clamp((Number(chars) || 0) / TUNING.REFERENCE_CHARS, 1, TUNING.LENGTH_FACTOR_MAX);
}

/**
 * The user's usual time for a right answer to a question of ordinary length.
 * @param {number[]} window Recent right-answer times (see recordSpeed).
 */
export function usualMs(window) {
  const pace = Array.isArray(window) && window.length >= TUNING.SPEED_MIN_SAMPLES ? median(window) : TUNING.EXPECTED_MS_START;
  return clamp(pace, TUNING.EXPECTED_MS_MIN, TUNING.EXPECTED_MS_MAX);
}

/** The time a right answer to this particular question is expected to take. */
export function expectedMs(window, chars) {
  return usualMs(window) * lengthFactor(chars);
}

/**
 * Adds a right answer's time to the user's pace. Times are stored as if the question had been
 * of ordinary length, so questions with long choices do not make the user look slow. The median
 * of the window is used, so one answer given after a coffee break changes nothing.
 * @returns {number[]} The new window.
 */
export function recordSpeed(window, ms, chars) {
  if (!Number.isFinite(ms) || ms <= 0) return Array.isArray(window) ? window : [];
  const normalized = Math.round(Math.min(ms, TUNING.RESPONSE_MS_CAP) / lengthFactor(chars));
  return [...(Array.isArray(window) ? window : []), normalized].slice(-TUNING.SPEED_WINDOW);
}

// --- Rating an answer ---------------------------------------------------------------------------

/**
 * Quality of an answer on SM-2's 0-5 scale:
 *   0  "I don't know"        3  right, but slow
 *   1  wrong                 4  right
 *   2  right, but so slow    5  right and fast
 *      that it was hesitation or a guess
 * 0-2 send the word back to learning.
 *
 * @param {{ correct: boolean, ms?: number, unknown?: boolean }} answer
 * @param {number} expected  From expectedMs().
 */
export function rateAnswer(answer, expected) {
  if (answer.unknown) return 0;
  if (!answer.correct) return 1;
  // ASSUMPTION: a right answer that took more than HESITANT_ABOVE times the expected time is
  // rated 2. It still counts as right (no lapse, no worse error rate), but the word is not
  // considered known: its run ends and it is asked again soon.
  // No usable time (an old client, a paused clock): an ordinary right answer.
  if (!Number.isFinite(answer.ms) || answer.ms <= 0 || !(expected > 0)) return 4;
  const ratio = answer.ms / expected;
  if (ratio > TUNING.HESITANT_ABOVE) return 2;
  if (ratio > TUNING.SLOW_ABOVE) return 3;
  if (ratio < TUNING.FAST_BELOW) return 5;
  return 4;
}

// --- Scheduling ---------------------------------------------------------------------------------

/** The gap after a right answer of the given quality (3-5), in minutes. */
function nextGap(previous, ease, quality) {
  const ladder = TUNING.LADDER_MINUTES;
  const last = ladder[ladder.length - 1];
  // On the ladder: the next rung. Beyond it: the previous gap times the ease.
  // ASSUMPTION: speed never shortens a gap below the first rung, so a new word answered right
  // but slowly comes back after the same ten minutes as one answered wrongly.
  const base = previous < last ? ladder.find((rung) => rung > previous) : previous * ease;
  return Math.round(clamp(base * TUNING.SPEED_FACTOR[quality], ladder[0], TUNING.MAX_GAP_MINUTES));
}

/** Difficulty of a word, 0 (easy) to 1 (hard), from its error rate, lost ease and slowness. */
export function difficultyOf(stats, usual = TUNING.EXPECTED_MS_START) {
  const weights = TUNING.DIFFICULTY_WEIGHTS;
  // (wrong + 1) / (answers + 2): a word with few answers is neither easy nor hard yet.
  const errors = (stats.a - stats.k + 1) / (stats.a + 2);
  const ease = clamp((TUNING.EASE_START - stats.e) / (TUNING.EASE_START - TUNING.EASE_MIN), 0, 1);
  const slowness = stats.m > 0 ? clamp((stats.m / usual - 1) / 2, 0, 1) : 0;
  return round(clamp(weights.errors * errors + weights.ease * ease + weights.slowness * slowness, 0, 1), 2);
}

/** The fields of schema 2 and what a word without them has. */
const LATER_FIELDS = Object.freeze({ n: 0, y: '', o: 0, g: 0, c1: 0, c0: 0, w1: 0, w0: 0, l1: 0, l0: 0 });

/** Whether a run of right answers makes a word learned. */
export function runIsLearned(stats, { learnedStreak = TUNING.LEARNED_STREAK, learnedDays = TUNING.LEARNED_DAYS, requireOtherMode = true } = {}) {
  return (stats.n || 0) >= learnedStreak && runDays(stats.y).length >= learnedDays && (!requireOtherMode || (stats.o || 0) >= 1);
}

/**
 * The word's history after an answer, and when it is due again.
 *
 * @param {CardStats | null} previous
 * @param {{ quality: number, correct: boolean, ms?: number, mode?: 'classic' | 'writing' | 'listening', hinted?: boolean }} answer
 *   `quality` from rateAnswer(). `mode`: how the word was asked. `hinted`: letters were given
 *   away first: the answer is right, but it is not part of a run of right answers.
 * @param {number} now
 * @param {number} [usual]  The user's usual answer time (usualMs()), for the difficulty score.
 * @param {{ day?: string, learnedStreak?: number, learnedDays?: number, requireOtherMode?: boolean }} [rules]
 *   `day`: the calendar day of the answer where the user is ('YYYY-MM-DD'; progress.js: localDay).
 *   The rest: when a word counts as learned (the settings; TUNING has the defaults).
 * @returns {{ stats: CardStats, dueAt: number, learnedNow: boolean, unlearned: boolean }}
 *   learnedNow / unlearned: this answer made the word learned / took that away again.
 */
export function applyAnswer(previous, answer, now, usual, rules = {}) {
  const stats = { ...LATER_FIELDS, ...newStats(), ...(previous || {}) };
  const mode = MODES.includes(answer.mode) ? answer.mode : 'classic';
  const passed = answer.quality >= 3;
  const wasLearned = stats.g > 0;
  stats.a += 1;
  if (answer.correct) stats.k += 1;
  stats.s = passed ? stats.s + 1 : 0;
  if (!answer.correct) stats.l += 1;
  // each way of asking keeps its own count; the state of the word is one
  stats[`${MODE_LETTER[mode]}${answer.correct ? 1 : 0}`] += 1;
  stats.e = round(clamp(stats.e + TUNING.EASE_CHANGE[answer.quality], TUNING.EASE_MIN, TUNING.EASE_MAX), 2);
  stats.i = passed ? Math.round(clamp(nextGap(stats.i, stats.e, answer.quality) * TUNING.MODE_FACTOR[mode], TUNING.LADDER_MINUTES[0], TUNING.MAX_GAP_MINUTES)) : TUNING.RELEARN_MINUTES;
  if (Number.isFinite(answer.ms) && answer.ms > 0) {
    const ms = Math.min(answer.ms, TUNING.RESPONSE_MS_CAP);
    stats.m = Math.round(stats.m > 0 ? stats.m + TUNING.MEAN_WEIGHT * (ms - stats.m) : ms);
  }
  stats.x = now;

  // The run of right answers that makes a word learned. A wrong answer ends it, and a word
  // that was learned is not any more; a right answer with a hint neither adds to it nor ends it.
  if (!answer.correct) {
    stats.n = 0;
    stats.y = '';
    stats.o = 0;
    stats.g = 0;
  } else if (!answer.hinted) {
    stats.n += 1;
    if (DAY.test(rules.day || '')) stats.y = runDays(`${stats.y},${rules.day}`).join(',');
    if (mode !== 'classic') stats.o += 1;
  }
  if (!stats.g && runIsLearned(stats, rules)) stats.g = now;
  // Learned: asked very rarely, whatever the speed of the last answer was.
  if (stats.g) stats.i = Math.max(stats.i, TUNING.LEARNED_MIN_GAP_MINUTES);

  stats.d = difficultyOf(stats, usual);
  const result = { dueAt: now + stats.i * MINUTE, learnedNow: !wasLearned && stats.g > 0, unlearned: wasLearned && stats.g === 0 };
  // kept only when they say something (see normalizeStats)
  for (const key of Object.keys(LATER_FIELDS)) if (!stats[key]) delete stats[key];
  return { stats, ...result };
}

/**
 * "Ask later", or a question that went unanswered: nothing is held against the word and nothing
 * about it changes, it just comes back a little later.
 * ASSUMPTION: such a question does not use up the word's turn in the current round of questions
 * (selection.js), so that "a little later" really is that and not "in the next round".
 * @returns {{ stats: CardStats | null, dueAt: number }}  `stats` stays null for a word that has
 *   never been answered.
 */
export function postpone(previous, now) {
  return { stats: previous ? { ...previous } : null, dueAt: now + TUNING.POSTPONE_MINUTES * MINUTE };
}

/**
 * Where a word stands.
 * @returns {'new' | 'learning' | 'learned' | 'hard'}
 */
export function statusOf(stats) {
  if (!stats || stats.a === 0) return 'new';
  // Learned is a state of its own (a run of right answers over several days), not a long gap.
  if (stats.g > 0) return 'learned';
  if (stats.a >= TUNING.HARD_MIN_ATTEMPTS && (stats.d >= TUNING.HARD_DIFFICULTY || stats.l >= TUNING.HARD_LAPSES)) return 'hard';
  return 'learning';
}

/**
 * The Leitner-style box of a word: how many rungs beyond the first its gap has reached.
 * ASSUMPTION: the entry's `box` (from the first specification, synchronised as `b`) is kept and
 * derived from the gap, so older versions and the synchronised record stay meaningful.
 */
export function levelOf(stats) {
  if (!stats) return 0;
  return TUNING.LADDER_MINUTES.slice(1).filter((rung) => stats.i >= rung).length;
}
