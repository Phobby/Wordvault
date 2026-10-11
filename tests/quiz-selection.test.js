// Which word is asked next.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { applyAnswer } from '../src/quiz/learning.js';
import { SELECTION, isDue, selectCard, weightOf } from '../src/quiz/selection.js';
import { createRandom } from './helpers/random.js';

const T0 = 1_790_000_000_000;
const MINUTE = 60_000;
const DAY = 1440 * MINUTE;

const card = (id, fields = {}) => ({ id, text: id, translation: `${id}-tr`, dueAt: 0, quiz: null, ...fields });
/** A card with a history: the given answer qualities, the last one at `lastAt`. */
function seasoned(id, qualities, lastAt = T0 - DAY) {
  let stats = null;
  let dueAt = 0;
  for (const quality of qualities) ({ stats, dueAt } = applyAnswer(stats, { quality, correct: quality >= 2, ms: 4000 }, lastAt));
  return card(id, { quiz: stats, dueAt });
}
function tally(cards, options, rounds = 6000, seed = 11) {
  const random = createRandom(seed);
  const counts = Object.fromEntries(cards.map((c) => [c.id, 0]));
  for (let n = 0; n < rounds; n++) counts[selectCard(cards, { now: T0, random: random.next, ...options }).card.id]++;
  return counts;
}

test('words never asked can be asked at once; scheduled words only when their time has come', () => {
  assert.equal(isDue(card('new'), T0), true);
  assert.equal(isDue(card('later', { dueAt: T0 + 1 }), T0), false);
  assert.equal(isDue(card('now', { dueAt: T0 }), T0), true);
  const pick = selectCard([card('new'), card('later', { dueAt: T0 + DAY, quiz: { a: 1, k: 1, s: 1, e: 2.5, i: 1440, l: 0, m: 0, d: 0.2, x: T0 } })], { now: T0, random: createRandom(1).next });
  assert.deepEqual([pick.card.id, pick.why], ['new', 'new']);
});

test('difficult words are asked more often than easy ones', () => {
  const easy = seasoned('easy', [4, 4, 5, 5]);
  const hard = seasoned('hard', [1, 1, 4, 1]);
  easy.dueAt = hard.dueAt = T0; // both due right now, neither overdue
  assert.ok(weightOf(hard, T0) > weightOf(easy, T0) * 1.5);
  const counts = tally([easy, hard, card('new')], {});
  assert.ok(counts.hard > counts.easy * 1.5, JSON.stringify(counts));
  assert.ok(counts.easy > 0 && counts.new > 0, 'but nothing is starved');
});

test('overdue words are asked more often than words that have just come due', () => {
  const fresh = seasoned('fresh', [4, 4]);
  const overdue = seasoned('overdue', [4, 4]);
  fresh.dueAt = T0; // due this instant
  overdue.dueAt = T0 - 3 * DAY; // its one-day gap ran out three days ago
  assert.equal(fresh.quiz.d, overdue.quiz.d);
  const counts = tally([fresh, overdue], {});
  assert.ok(counts.overdue > counts.fresh * 1.5, JSON.stringify(counts));
  // being overdue counts up to a cap, so one forgotten word does not crowd out everything else
  const ancient = { ...overdue, id: 'ancient', dueAt: T0 - 300 * DAY };
  assert.equal(weightOf(ancient, T0), weightOf({ ...overdue, dueAt: T0 - SELECTION.OVERDUE_CAP * DAY }, T0));
});

test('the same word is never asked twice in a row', () => {
  const cards = [card('a'), card('b'), card('c'), card('d'), card('e')];
  const random = createRandom(5);
  const recent = [];
  let previous = null;
  for (let n = 0; n < 3000; n++) {
    const { card: picked } = selectCard(cards, { now: T0, random: random.next, recent });
    assert.notEqual(picked.id, previous);
    assert.ok(!recent.slice(-SELECTION.RECENT_QUESTIONS).includes(picked.id), 'nor within the last few questions');
    recent.push(picked.id);
    previous = picked.id;
  }
  assert.equal(new Set(recent).size, 5);
});

test('a word answered wrongly comes back only after a few other questions', () => {
  const failed = seasoned('failed', [4, 4, 1], T0 - 11 * MINUTE); // its ten minutes are up
  assert.ok(isDue(failed, T0));
  const others = ['a', 'b', 'c', 'd'].map((id) => card(id));
  const random = createRandom(9);
  for (let n = 0; n < 500; n++) {
    assert.notEqual(selectCard([failed, ...others], { now: T0, random: random.next, recent: ['failed'] }).card.id, 'failed');
    assert.notEqual(selectCard([failed, ...others], { now: T0, random: random.next, recent: ['failed', 'a', 'b'] }).card.id, 'failed');
  }
  // three other questions later it is back, and likely: it is difficult
  const counts = tally([failed, ...others], { recent: ['failed', 'a', 'b', 'c'] });
  assert.ok(counts.failed > counts.d, JSON.stringify(counts));
});

test('with few words the "not recently" rule relaxes, but never to an immediate repeat', () => {
  const two = [card('a'), card('b')];
  const random = createRandom(2);
  for (let n = 0; n < 200; n++) {
    assert.equal(selectCard(two, { now: T0, random: random.next, recent: ['x', 'b', 'a'] }).card.id, 'b', 'only the last one is left out when there is nothing else');
  }
  assert.equal(selectCard([card('a')], { now: T0, recent: ['a'] }), null, 'a single word is not asked again straight away');
  assert.equal(selectCard([card('a')], { now: T0, recent: [] }).card.id, 'a');
  assert.equal(selectCard([], { now: T0 }), null);
});

test('nothing due: the hardest word is asked early, or none if that is switched off', () => {
  const cards = [seasoned('easy', [4, 4, 4, 5], T0 - 2 * DAY), seasoned('hard', [1, 4, 1, 4, 4], T0 - DAY), seasoned('medium', [4, 3, 4], T0 - 3 * DAY)];
  for (const c of cards) c.dueAt = T0 + 5 * DAY;
  assert.equal(selectCard(cards, { now: T0, allowNotDue: false }), null);
  const pick = selectCard(cards, { now: T0, allowNotDue: true });
  assert.deepEqual([pick.card.id, pick.why], ['hard', 'early']);
  assert.equal(selectCard(cards, { now: T0, allowNotDue: true, recent: ['hard'] }).card.id, 'medium', 'not the one just asked');

  // equally hard words: the one that has not been asked for longest
  const twins = [seasoned('recent', [4, 4], T0 - DAY), seasoned('stale', [4, 4], T0 - 9 * DAY)];
  for (const c of twins) c.dueAt = T0 + DAY;
  assert.equal(selectCard(twins, { now: T0 }).card.id, 'stale');
});

test('due words always go before words asked early', () => {
  const notDue = seasoned('hard-not-due', [1, 1, 1, 1]);
  notDue.dueAt = T0 + DAY;
  const due = seasoned('easy-due', [4, 4, 5]);
  due.dueAt = T0 - MINUTE;
  const random = createRandom(4);
  for (let n = 0; n < 200; n++) assert.equal(selectCard([notDue, due], { now: T0, random: random.next }).card.id, 'easy-due');
});
