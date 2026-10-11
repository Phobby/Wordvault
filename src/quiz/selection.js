// Which word is asked next.
//
// Words that are due are drawn at random, weighted so that overdue and difficult words come up
// more often. A word that was asked a moment ago is left out, so nothing is asked twice in a
// row and a word that was just answered wrongly returns only after a few other questions.
//
// Questions go in rounds, so that the whole vault gets its turn: a word that has been answered
// in the current round waits for the next one, even if its time comes up again before the
// others have been asked. The exception is a word whose last answer was not good enough: that
// one comes back within the round, which is how difficult words end up being asked more often.
// When every word has had its turn a new round begins.

import { TUNING, difficultyOf, newStats } from './learning.js';

const MINUTE = 60_000;

export const SELECTION = Object.freeze({
  /** How many of the most recently asked words are left out (at least the last one always is).
   *  ASSUMPTION: this is what "a few questions later" means for a word answered wrongly. */
  RECENT_QUESTIONS: 3,
  /** Weight of a due word: (1 + OVERDUE_WEIGHT x how overdue it is) x (1 + DIFFICULTY_WEIGHT x
   *  difficulty). The two multiply, so that a difficult word stays as much more likely than an
   *  easy one when everything is overdue (after a few days away) as when nothing is. */
  OVERDUE_WEIGHT: 1.5,
  /** "How overdue" is the delay measured in the word's own gaps, counted up to this many. */
  OVERDUE_CAP: 2,
  DIFFICULTY_WEIGHT: 4,
});

const statsOf = (card) => card.quiz || newStats();
/** A word's difficulty; one that was never answered is neither easy nor hard. */
const hardness = (card) => (card.quiz?.a > 0 ? card.quiz.d : difficultyOf(newStats()));

/** Whether a word may be asked now. Words never asked are due at once. */
export function isDue(card, now) {
  return !card.dueAt || card.dueAt <= now;
}

/** How overdue a word is, in units of its own gap: 0 (just due, or new) up to OVERDUE_CAP. */
function overdue(card, now) {
  const stats = statsOf(card);
  if (!card.dueAt || stats.a === 0) return 0;
  const gap = Math.max(stats.i, TUNING.RELEARN_MINUTES) * MINUTE;
  return Math.min(SELECTION.OVERDUE_CAP, Math.max(0, (now - card.dueAt) / gap));
}

/** Chance of a due word being drawn, relative to the others. */
export function weightOf(card, now) {
  return (1 + SELECTION.OVERDUE_WEIGHT * overdue(card, now)) * (1 + SELECTION.DIFFICULTY_WEIGHT * hardness(card));
}

function draw(cards, now, random) {
  const weights = cards.map((card) => weightOf(card, now));
  let point = random() * weights.reduce((sum, weight) => sum + weight, 0);
  for (let index = 0; index < cards.length; index++) {
    point -= weights[index];
    if (point < 0) return cards[index];
  }
  return cards[cards.length - 1];
}

/** Leaves out the words asked most recently; as few as it takes to have something left. */
function withoutRecent(cards, recent) {
  for (let size = Math.min(SELECTION.RECENT_QUESTIONS, recent.length); size >= 1; size--) {
    const skip = new Set(recent.slice(-size));
    const rest = cards.filter((card) => !skip.has(card.id));
    if (rest.length > 0) return rest;
  }
  // Only the word asked last is left. It is not asked twice in a row.
  return recent.length > 0 ? [] : cards;
}

/**
 * @param {import('../lib/vault.js').VaultEntry[]} cards  The words that can be asked at all.
 * @param {Object} options
 * @param {number} options.now
 * @param {() => number} [options.random]
 * @param {string[]} [options.recent]       Ids of the words asked most recently, newest last.
 * @param {boolean} [options.allowNotDue]   When nothing is due: ask the hardest word (or, among
 *                                          equally hard ones, the one not asked for longest).
 * @param {number} [options.roundStartedAt] When the current round of questions began (0: rounds
 *                                          are not kept track of, every word may be asked).
 * @returns {{ card: object, why: 'new' | 'due' | 'early', newRound: boolean } | null}
 *   null if nothing is to be asked. `newRound`: every word had had its turn, so this question
 *   starts the next round (the caller notes the time).
 */
export function selectCard(cards, { now, random = Math.random, recent = [], allowNotDue = true, roundStartedAt = 0 }) {
  /** Answered since the round began: the word has had its turn. */
  const hadTurn = (card) => roundStartedAt > 0 && statsOf(card).x >= roundStartedAt;
  /** The last answer was wrong or hesitant: the word is being relearned and does not wait. */
  const relearning = (card) => statsOf(card).a > 0 && statsOf(card).s === 0;
  const drawn = (pool, newRound) => {
    const card = draw(pool, now, random);
    return { card, why: statsOf(card).a === 0 ? 'new' : 'due', newRound };
  };

  const due = cards.filter((card) => isDue(card, now));
  const waiting = withoutRecent(due.filter((card) => !hadTurn(card) || relearning(card)), recent);
  if (waiting.length > 0) return drawn(waiting, false);
  // ASSUMPTION: "the whole vault takes turns" outranks a word's own date within a round: a word
  // answered right waits for the next round even if its ten minutes are up before that.
  const again = withoutRecent(due, recent);
  if (again.length > 0) return drawn(again, true);

  if (!allowNotDue) return null;
  const notDue = cards.filter((card) => !isDue(card, now));
  let early = withoutRecent(notDue.filter((card) => !hadTurn(card)), recent);
  const newRound = early.length === 0;
  if (newRound) early = withoutRecent(notDue, recent);
  if (early.length === 0) return null;
  // Hardest first (in steps of 0.1, so near-equal words count as equal), then longest unasked.
  const step = (card) => Math.round(hardness(card) * 10);
  const before = (a, b) => step(a) > step(b) || (step(a) === step(b) && statsOf(a).x < statsOf(b).x);
  return { card: early.reduce((best, card) => (before(card, best) ? card : best)), why: 'early', newRound };
}
