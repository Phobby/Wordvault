// The learning algorithm: how an answer is rated and what it does to a word.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { TUNING, applyAnswer, difficultyOf, expectedMs, lengthFactor, levelOf, newStats, normalizeStats, postpone, rateAnswer, recordSpeed, statusOf, usualMs } from '../src/quiz/learning.js';

const T0 = 1_790_000_000_000;
const MINUTE = 60_000;
const DAY = 1440;

/** Answers a card and returns its new statistics (ms chosen to give the wanted quality). */
const QUALITY_MS = { 2: 13_000, 3: 8000, 4: 4000, 5: 1500 };
function answer(stats, quality, now = T0) {
  const correct = quality >= 2;
  return applyAnswer(stats, { quality, correct, ms: correct ? QUALITY_MS[quality] : 3000 }, now);
}
/** A card after a run of ordinary right answers. */
const after = (...qualities) => qualities.reduce((stats, quality) => answer(stats, quality).stats, null);

test('answers are rated by correctness and by speed relative to the expected time', () => {
  const expected = 4000;
  assert.equal(rateAnswer({ correct: false, ms: 500 }, expected), 1, 'wrong is wrong, however fast');
  assert.equal(rateAnswer({ correct: false, unknown: true }, expected), 0, '"I don\'t know"');
  assert.equal(rateAnswer({ correct: true, ms: 2000 }, expected), 5, 'fast');
  assert.equal(rateAnswer({ correct: true, ms: 2400 }, expected), 4, 'the fast limit is 0.6x');
  assert.equal(rateAnswer({ correct: true, ms: 4000 }, expected), 4, 'normal');
  assert.equal(rateAnswer({ correct: true, ms: 6400 }, expected), 4, 'the slow limit is 1.6x');
  assert.equal(rateAnswer({ correct: true, ms: 7000 }, expected), 3, 'slow');
  assert.equal(rateAnswer({ correct: true, ms: 12_000 }, expected), 3);
  assert.equal(rateAnswer({ correct: true, ms: 12_500 }, expected), 2, 'beyond 3x it is hesitation or a guess');
  for (const ms of [undefined, NaN, 0, -5]) assert.equal(rateAnswer({ correct: true, ms }, expected), 4, 'no usable time: an ordinary right answer');
});

test('same card, different answers: gap and ease come out in the order fast > normal > slow > wrong', () => {
  // from three typical points in a word's life: learning (10 min), early review (1 day), mature (30 days)
  for (const start of [after(4), after(4, 4), { ...after(4, 4, 4, 4), i: 30 * DAY }]) {
    const [wrong, hesitant, slow, normal, fast] = [1, 2, 3, 4, 5].map((quality) => answer(start, quality));
    assert.ok(fast.stats.i > normal.stats.i && normal.stats.i > slow.stats.i && slow.stats.i > wrong.stats.i, `gaps from ${start.i} min: ${[wrong, slow, normal, fast].map((r) => r.stats.i)}`);
    assert.ok(fast.stats.e > normal.stats.e && normal.stats.e > slow.stats.e && slow.stats.e > wrong.stats.e, `ease: ${[wrong, slow, normal, fast].map((r) => r.stats.e)}`);
    assert.ok(fast.dueAt > normal.dueAt && normal.dueAt > slow.dueAt && slow.dueAt > wrong.dueAt);
    // a hesitant right answer is treated like a wrong one for the gap, a little milder for the ease
    assert.equal(hesitant.stats.i, wrong.stats.i);
    assert.ok(hesitant.stats.e > wrong.stats.e && hesitant.stats.e < slow.stats.e);
  }
  // a brand-new word comes back in ten minutes whatever happened, unless it was obviously known
  const [wrong, slow, normal, fast] = [1, 3, 4, 5].map((quality) => answer(null, quality));
  assert.deepEqual([wrong.stats.i, slow.stats.i, normal.stats.i], [10, 10, 10]);
  assert.ok(fast.stats.i > normal.stats.i);
  assert.ok(fast.stats.e > normal.stats.e && normal.stats.e > slow.stats.e && slow.stats.e > wrong.stats.e);
});

test('right answers walk the ladder: 10 minutes, 1 day, 3 days, 7 days, then gap x ease', () => {
  let stats = null;
  const gaps = [];
  for (let n = 0; n < 6; n++) {
    stats = answer(stats, 4).stats;
    gaps.push(stats.i);
  }
  assert.deepEqual(gaps, [10, DAY, 3 * DAY, 7 * DAY, Math.round(7 * DAY * 2.5), Math.round(Math.round(7 * DAY * 2.5) * 2.5)]);
  assert.equal(stats.e, TUNING.EASE_START, 'ordinary right answers leave the ease alone');
  assert.equal(answer(null, 4, T0).dueAt, T0 + 10 * MINUTE);
  assert.equal(answer(after(4), 4, T0).dueAt, T0 + DAY * MINUTE);
  // fast answers get there sooner, slow ones later
  const fast = [5, 5, 5, 5].reduce((s, q) => answer(s, q).stats, null);
  const slow = [3, 3, 3, 3].reduce((s, q) => answer(s, q).stats, null);
  assert.ok(fast.i > after(4, 4, 4, 4).i && after(4, 4, 4, 4).i > slow.i, `${fast.i} > ${after(4, 4, 4, 4).i} > ${slow.i}`);
});

test('a wrong or hesitant answer sends the word back to learning', () => {
  const mature = { ...after(4, 4, 4, 4), i: 60 * DAY };
  const failed = answer(mature, 1);
  assert.equal(failed.stats.i, TUNING.RELEARN_MINUTES);
  assert.equal(failed.dueAt, T0 + TUNING.RELEARN_MINUTES * MINUTE);
  assert.equal(failed.stats.s, 0, 'the run of right answers ends');
  assert.equal(failed.stats.l, mature.l + 1);
  assert.equal(failed.stats.e, 2.3);
  assert.equal(answer(failed.stats, 4).stats.i, DAY, 'and from there it climbs the ladder again');

  const hesitant = answer(mature, 2);
  assert.equal(hesitant.stats.i, TUNING.RELEARN_MINUTES);
  assert.equal(hesitant.stats.l, mature.l, 'a right answer is not a lapse, however slow');
  assert.equal(hesitant.stats.k, mature.k + 1, 'and still counts as right in the accuracy');

  const unknown = applyAnswer(mature, { quality: 0, correct: false }, T0);
  assert.equal(unknown.stats.l, mature.l + 1, '"I don\'t know" counts as wrong');
});

test('ease stays within its limits', () => {
  let stats = null;
  for (let n = 0; n < 30; n++) stats = answer(stats, 1).stats;
  assert.equal(stats.e, TUNING.EASE_MIN);
  for (let n = 0; n < 30; n++) stats = answer(stats, 5).stats;
  assert.equal(stats.e, TUNING.EASE_MAX);
  assert.ok(stats.i <= TUNING.MAX_GAP_MINUTES);
});

test('counters, average answer time and difficulty', () => {
  let stats = answer(null, 4).stats; // right, 4000 ms
  assert.deepEqual([stats.a, stats.k, stats.s, stats.l, stats.m, stats.x], [1, 1, 1, 0, 4000, T0]);
  stats = applyAnswer(stats, { quality: 3, correct: true, ms: 8000 }, T0 + 1).stats;
  assert.equal(stats.m, 5200, 'moving average: 4000 + 0.3 x (8000 - 4000)');
  stats = applyAnswer(stats, { quality: 1, correct: false, ms: 999_999 }, T0 + 2).stats;
  assert.equal(stats.m, 5200 + Math.round(0.3 * (60_000 - 5200)), 'a time beyond the cap counts as the cap');
  assert.deepEqual([stats.a, stats.k, stats.s, stats.l], [3, 2, 0, 1]);

  // difficulty: 0..1, higher for words that are answered wrongly
  const easy = after(4, 4, 4, 5, 5);
  const hard = [1, 1, 4, 1, 1].reduce((s, q) => answer(s, q).stats, null);
  assert.ok(easy.d < 0.25 && hard.d >= 0.6, `easy ${easy.d}, hard ${hard.d}`);
  assert.ok(difficultyOf(newStats()) > easy.d && difficultyOf(newStats()) < hard.d, 'a new word is in between');
  for (const stats2 of [easy, hard]) assert.ok(stats2.d >= 0 && stats2.d <= 1);
});

test('the speed threshold follows the user\'s own pace', () => {
  assert.equal(usualMs([]), 4000, 'about four seconds before anything is known');
  assert.equal(usualMs([1000, 1000, 1000, 1000]), 4000, 'four answers are not yet a pace');
  let quick = [];
  for (const ms of [2000, 2100, 1900, 2200, 2000, 1800]) quick = recordSpeed(quick, ms, 40);
  let slow = [];
  for (const ms of [7000, 7500, 6800, 7200, 7100, 6900]) slow = recordSpeed(slow, ms, 40);
  assert.equal(usualMs(quick), 2000);
  assert.equal(usualMs(slow), 7050);
  // the same four seconds: slow for the quick user, fast for the slow one
  assert.equal(rateAnswer({ correct: true, ms: 4000 }, expectedMs(quick, 40)), 3);
  assert.equal(rateAnswer({ correct: true, ms: 4000 }, expectedMs(slow, 40)), 5);
  assert.equal(rateAnswer({ correct: true, ms: 4000 }, expectedMs([], 40)), 4);
});

test('one extreme answer time does not move the threshold', () => {
  let window = [];
  for (const ms of [2000, 2100, 1900, 2200, 2000, 1800, 2050]) window = recordSpeed(window, ms, 40);
  const before = usualMs(window);
  window = recordSpeed(window, 10 * 60_000, 40); // came back from a coffee break
  assert.ok(Math.abs(usualMs(window) - before) <= 50, `${before} -> ${usualMs(window)}`);
  assert.ok(Math.max(...window) <= TUNING.RESPONSE_MS_CAP, 'and it is stored capped');
  // limits: nobody is expected to answer in a blink, or allowed a minute
  assert.equal(usualMs([100, 100, 100, 100, 100, 100]), TUNING.EXPECTED_MS_MIN);
  assert.equal(usualMs([50_000, 50_000, 50_000, 50_000, 50_000]), TUNING.EXPECTED_MS_MAX);
  // the window slides
  for (let n = 0; n < 60; n++) window = recordSpeed(window, 3000, 40);
  assert.equal(window.length, TUNING.SPEED_WINDOW);
  assert.equal(usualMs(window), 3000);
  assert.deepEqual(recordSpeed([1, 2], NaN, 40), [1, 2], 'an unusable time is not recorded');
});

test('longer choices are given more time, and do not make the user look slow', () => {
  assert.equal(lengthFactor(20), 1);
  assert.equal(lengthFactor(40), 1);
  assert.equal(lengthFactor(80), 2);
  assert.equal(lengthFactor(4000), TUNING.LENGTH_FACTOR_MAX);
  assert.equal(expectedMs([], 80), 8000);
  assert.equal(rateAnswer({ correct: true, ms: 7000 }, expectedMs([], 40)), 3, 'slow for four short words');
  assert.equal(rateAnswer({ correct: true, ms: 7000 }, expectedMs([], 80)), 4, 'normal for four phrases');
  // 6 s on long choices is stored as 3 s of "ordinary" pace
  assert.deepEqual(recordSpeed([], 6000, 80), [3000]);
});

test('"ask later" and unanswered questions cost nothing', () => {
  const stats = after(4, 4, 1);
  const later = postpone(stats, T0 + 5);
  assert.deepEqual(later.stats, stats, 'nothing about the word changes, not even "last answered"');
  assert.equal(later.dueAt, T0 + 5 + TUNING.POSTPONE_MINUTES * MINUTE);
  const fresh = postpone(null, T0);
  assert.equal(fresh.stats, null, 'a word that was never answered still has no history');
  assert.equal(statusOf(fresh.stats), 'new', 'a postponed new word is still new');
});

test('statuses: new, learning, learned, hard', () => {
  assert.equal(statusOf(null), 'new');
  assert.equal(statusOf(newStats()), 'new');
  assert.equal(statusOf(after(4)), 'learning');
  assert.equal(statusOf(after(4, 4, 4)), 'learning');
  assert.equal(statusOf(after(4, 4, 4, 4)), 'learned', 'the gap reached seven days');
  const struggling = [1, 1, 1, 4].reduce((s, q) => answer(s, q).stats, null);
  assert.equal(statusOf(struggling), 'hard');
  assert.equal(statusOf([1, 1].reduce((s, q) => answer(s, q).stats, null)), 'learning', 'two answers are too few to call a word hard');
  const recovered = [4, 4, 4, 4].reduce((s, q) => answer(s, q).stats, struggling);
  assert.equal(statusOf(recovered), 'learned', 'a hard word that made it is learned');
  assert.deepEqual([null, after(4), after(4, 4), after(4, 4, 4), after(4, 4, 4, 4)].map(levelOf), [0, 0, 1, 2, 3]);
});

test('statistics from outside are cleaned, and what answering produces is already clean', () => {
  assert.equal(normalizeStats(null), null);
  assert.equal(normalizeStats('x'), null);
  assert.equal(normalizeStats([]), null);
  assert.equal(normalizeStats({}), null, 'never asked: nothing to keep');
  assert.deepEqual(normalizeStats({ a: 5.7, k: 9, s: -1, e: 99, i: 1e12, l: 'x', m: 1e9, d: 7, x: T0, junk: { a: 1 } }), { a: 5, k: 5, s: 0, e: 3, i: TUNING.MAX_GAP_MINUTES, l: 0, m: 60_000, d: 1, x: T0 });
  const stats = [4, 1, 5, 3, 2].reduce((s, q) => answer(s, q).stats, null);
  assert.deepEqual(normalizeStats(stats), stats);
  assert.deepEqual(normalizeStats({ ...stats, zz: 7, nested: { no: 1 } }, { keepUnknown: true }), { ...stats, zz: 7 }, 'simple unknown fields can be kept for synchronisation');
});
