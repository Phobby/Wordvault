// The whole vault takes turns: quiz after quiz, driven by the alarm, every word is asked before
// any word that was answered right is asked again.

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { updateSettings } from '../src/lib/settings.js';
import { addEntry, getEntry } from '../src/lib/vault.js';
import { applyAnswer } from '../src/quiz/learning.js';
import { ALARM_NAME, ensureScheduled, getQuizState, recordAnswer, runScheduledQuiz } from '../src/quiz/scheduler.js';
import { selectCard } from '../src/quiz/selection.js';
import { createDevice, use } from './helpers/chrome.js';
import { createRandom } from './helpers/random.js';

const T0 = 1_790_000_000_000;
const MINUTE = 60_000;
const WORDS = ['book:kitap', 'door:kapı', 'tree:ağaç', 'water:su', 'house:ev', 'bread:ekmek', 'road:yol', 'sea:deniz', 'bird:kuş', 'cloud:bulut', 'stone:taş', 'star:yıldız', 'river:nehir', 'window:pencere', 'mountain:dağ', 'flower:çiçek', 'moon:ay', 'fire:ateş', 'apple:elma', 'horse:at'];

let device;
beforeEach(async (t) => {
  device = use(createDevice('device', { uiLanguage: 'tr' }));
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
});
const at = (t, time) => t.mock.timers.setTime(time);
const fill = async (count) => {
  for (const pair of WORDS.slice(0, count)) {
    const [text, translation] = pair.split(':');
    await addEntry({ text, translation, sourceLang: 'en', targetLang: 'tr' });
  }
};
const idsOf = (count) => WORDS.slice(0, count).map((pair) => `en|tr|${pair.split(':')[0]}`);

/**
 * Lets the timer run for `count` quizzes: each time the clock reaches the alarm, the alarm
 * fires, the quiz appears and is answered a few seconds later as `answer(id, nth)` says
 * (true: right, false: wrong, a string: that outcome).
 * @returns {Promise<{ asked: string[], times: number[] }>}
 */
async function runQuizzes(t, count, answer = () => true) {
  const asked = [];
  const times = [];
  for (let n = 0; n < count; n++) {
    at(t, device.alarmTimes()[ALARM_NAME]);
    assert.equal(device.fireAlarm(ALARM_NAME), true, `quiz ${n + 1}: an alarm is set`);
    assert.equal(await runScheduledQuiz(), 'shown', `quiz ${n + 1}`);
    const { payload } = device.browser.sent.at(-1).message;
    asked.push(payload.id);
    times.push(Date.now());
    at(t, Date.now() + 3000);
    const how = answer(payload.id, asked.filter((id) => id === payload.id).length);
    await recordAnswer(typeof how === 'string' ? { id: payload.id, outcome: how } : { id: payload.id, correct: how, ms: 3000, chars: payload.chars });
  }
  return { asked, times };
}

test('twenty quizzes in a row go through a vault of twenty words, one after the other', async (t) => {
  await fill(20);
  await updateSettings({ quizIntervalMinutes: 5 });
  await ensureScheduled();
  const { asked, times } = await runQuizzes(t, 20);
  assert.deepEqual([...asked].sort(), idsOf(20).sort(), 'every word was asked exactly once');
  // they came by themselves, one interval apart, starting one interval after the start
  assert.deepEqual(times, Array.from({ length: 20 }, (_, n) => T0 + (n + 1) * 5 * MINUTE));
});

test('a smaller vault is gone through completely before any word is asked a second time', async (t) => {
  await fill(12);
  await updateSettings({ quizIntervalMinutes: 5 });
  await ensureScheduled();
  // After ten minutes the first words are due again; they still wait for the others.
  const { asked } = await runQuizzes(t, 20);
  assert.equal(new Set(asked.slice(0, 12)).size, 12, `the first twelve are twelve different words: ${asked.slice(0, 12)}`);
  assert.equal(new Set(asked).size, 12);
  for (let n = 1; n < asked.length; n++) assert.notEqual(asked[n], asked[n - 1], `quiz ${n + 1} repeats the one before`);
  // the second round goes through the words again instead of circling among a few of them
  assert.equal(new Set(asked.slice(12)).size, 8, `the second round does not repeat either: ${asked.slice(12)}`);
});

test('a word answered wrongly comes back within the round, and the round still gets through', async (t) => {
  await fill(12);
  await updateSettings({ quizIntervalMinutes: 5 });
  await ensureScheduled();
  // The very first question is answered wrongly; everything after it is answered right.
  let failed = null;
  const { asked } = await runQuizzes(t, 13, (id) => {
    if (failed) return true;
    failed = id;
    return false;
  });
  const again = asked.indexOf(failed, 1);
  assert.ok(again > 3, `the word that went wrong was asked again, after a few other questions (question ${again + 1})`);
  assert.equal(asked.filter((id) => id === failed).length, 2);
  // It did not have to wait for a new round: twelve words and that one repeat make thirteen
  // questions, and each of the other words was asked exactly once among them.
  assert.equal(new Set(asked).size, 12, `all twelve words were asked: ${asked}`);
  const entry = await getEntry(failed);
  assert.deepEqual([entry.quiz.a, entry.quiz.l, entry.quiz.s], [2, 1, 1]);
});

test('"ask later" and unanswered questions do not use up a word\'s turn', async (t) => {
  await fill(12);
  await updateSettings({ quizIntervalMinutes: 5 });
  await ensureScheduled();
  // The first three questions are put off, closed and left unanswered; everything else is answered.
  let skipped = 0;
  const { asked } = await runQuizzes(t, 15, () => (skipped < 3 ? ['later', 'closed', 'timeout'][skipped++] : true));
  const putOff = asked.slice(0, 3);
  assert.equal(new Set(putOff).size, 3);
  for (const id of putOff) {
    assert.equal(asked.filter((asking) => asking === id).length, 2, `${id} was asked again in the same round`);
    assert.equal((await getEntry(id)).quiz.a, 1, 'and then answered');
  }
  assert.equal(new Set(asked).size, 12, 'twelve words and three repeats: the round went through all of them');
});

test('nothing due: the words asked early take turns as well', async (t) => {
  await fill(12);
  // Everything was answered right just now, so nothing is due for the next ten minutes.
  for (const id of idsOf(12)) await recordAnswer({ id, correct: true, ms: 3000, chars: 20 });
  await updateSettings({ quizIntervalMinutes: 1 });
  at(t, T0 + 1000);
  await ensureScheduled();
  const { asked } = await runQuizzes(t, 12);
  assert.equal(new Set(asked).size, 12, `twelve quizzes, twelve different words: ${asked}`);
});

test('the round is remembered across restarts of the background script', async (t) => {
  await fill(12);
  await updateSettings({ quizIntervalMinutes: 5 });
  await ensureScheduled();
  const first = await runQuizzes(t, 5);
  const { roundStartedAt } = await getQuizState();
  assert.equal(roundStartedAt, T0 + 5 * MINUTE, 'the round began with the first quiz');
  // Nothing lives in memory: the storage alone carries the round on.
  device.forgetAlarms();
  await ensureScheduled();
  const second = await runQuizzes(t, 7);
  assert.equal(new Set([...first.asked, ...second.asked]).size, 12);
  assert.equal((await getQuizState()).roundStartedAt, roundStartedAt);
});

// --- The rule itself (selection.js) --------------------------------------------------------------

const card = (id, fields = {}) => ({ id, text: id, translation: `${id}-tr`, dueAt: 0, quiz: null, ...fields });
function answered(id, qualities, when) {
  let stats = null;
  let dueAt = 0;
  for (const quality of qualities) ({ stats, dueAt } = applyAnswer(stats, { quality, correct: quality >= 2, ms: 4000 }, when));
  return card(id, { quiz: stats, dueAt });
}

test('selection: a word that has had its turn waits, a word being relearned does not', () => {
  const round = T0;
  const now = T0 + 60 * MINUTE;
  const done = answered('done', [4], T0 + MINUTE); // answered right in this round, due again since
  const failed = answered('failed', [1], T0 + 2 * MINUTE); // answered wrongly in this round
  const waiting = card('waiting');
  assert.ok(done.dueAt <= now && failed.dueAt <= now);
  const random = createRandom(3);
  const counts = { done: 0, failed: 0, waiting: 0 };
  for (let n = 0; n < 2000; n++) counts[selectCard([done, failed, waiting], { now, random: random.next, roundStartedAt: round }).card.id]++;
  assert.equal(counts.done, 0, 'the word that had its turn is not asked while others wait');
  assert.ok(counts.failed > counts.waiting && counts.waiting > 0, JSON.stringify(counts));

  // when every word has had its turn, a new round begins and says so
  const pick = selectCard([done, answered('also-done', [5], T0 + 3 * MINUTE)], { now, random: random.next, roundStartedAt: round });
  assert.equal(pick.newRound, true);
  assert.equal(selectCard([done, waiting], { now, random: random.next, roundStartedAt: round }).newRound, false);
  // without a round, every due word may be asked, as before
  assert.equal(selectCard([done], { now, random: random.next }).newRound, false);
});
