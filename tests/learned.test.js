// "Learned": right answers in a row, spread over several calendar days, not all of them picked
// from four. A learned word is asked rarely; a wrong answer takes the state away again. And how
// the three ways of asking feed one schedule.

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { LOCAL_SCHEMA, ensureSchema } from '../src/lib/schema.js';
import { createBackup, restoreBackup } from '../src/lib/backup.js';
import { updateSettings } from '../src/lib/settings.js';
import { addEntry, getEntry, listEntries } from '../src/lib/vault.js';
import { TUNING, applyAnswer, normalizeStats, runIsLearned, statusOf } from '../src/quiz/learning.js';
import { qualityOf, recordAnswer } from '../src/quiz/scheduler.js';
import { applyDocument, readLocalDocument } from '../src/sync/local.js';
import { mergeDocuments, serializeDocument } from '../src/sync/merge.js';
import { SCHEMA_VERSION, normalizeDocument } from '../src/sync/model.js';
import { createDevice, use } from './helpers/chrome.js';

const T0 = 1_800_000_000_000;
const DAY_MS = 86_400_000;
const day = (index) => `2026-10-${String(10 + index).padStart(2, '0')}`;

/** Answers in a row: [mode, right?, day index, hinted?]. */
function run(answers, rules = {}, start = null) {
  let stats = start;
  let last = null;
  answers.forEach(([mode, correct, dayIndex, hinted = false], index) => {
    last = applyAnswer(stats, { quality: correct ? (hinted ? 3 : 4) : 1, correct, mode, hinted }, T0 + dayIndex * DAY_MS + index, undefined, { day: day(dayIndex), ...rules });
    stats = last.stats;
  });
  return { stats, last };
}

test('five right in a row over three days, one of them typed or heard: learned', () => {
  const { stats, last } = run([['classic', true, 0], ['classic', true, 0], ['writing', true, 1], ['classic', true, 1], ['classic', true, 2]]);
  assert.equal(statusOf(stats), 'learned');
  assert.equal(last.learnedNow, true);
  assert.equal(stats.g, T0 + 2 * DAY_MS + 4, 'when it became learned');
  assert.deepEqual([stats.n, stats.y, stats.o], [5, `${day(0)},${day(1)},${day(2)}`, 1]);
  assert.ok(stats.i >= TUNING.LEARNED_MIN_GAP_MINUTES, 'asked again in thirty days at the earliest');
  assert.equal(last.dueAt, T0 + 2 * DAY_MS + 4 + stats.i * 60_000);
});

test('not learned: too few in a row, too few days, or only picked from four', () => {
  const four = run([['writing', true, 0], ['classic', true, 1], ['classic', true, 2], ['classic', true, 3]]);
  assert.equal(statusOf(four.stats), 'learning', 'four in a row');
  const twoDays = run([['writing', true, 0], ['classic', true, 0], ['classic', true, 0], ['classic', true, 1], ['classic', true, 1], ['classic', true, 1]]);
  assert.equal(statusOf(twoDays.stats), 'learning', 'six in a row, but on two days');
  const sameDay = run(Array.from({ length: 9 }, () => ['writing', true, 0]));
  assert.equal(statusOf(sameDay.stats), 'learning', 'nine typed answers on one day');
  const onlyClassic = run([['classic', true, 0], ['classic', true, 1], ['classic', true, 2], ['classic', true, 3], ['classic', true, 4]]);
  assert.equal(statusOf(onlyClassic.stats), 'learning', 'recognised, never recalled');
  assert.equal(statusOf(run([['listening', true, 5]], {}, onlyClassic.stats).stats), 'learned', 'one heard answer completes it');
});

test('the rule can be changed in the settings: how many in a row, and whether one must be typed or heard', () => {
  const classic = [['classic', true, 0], ['classic', true, 1], ['classic', true, 2], ['classic', true, 3], ['classic', true, 4]];
  assert.equal(statusOf(run(classic, { requireOtherMode: false }).stats), 'learned');
  assert.equal(statusOf(run(classic.slice(0, 3), { requireOtherMode: false, learnedStreak: 3 }).stats), 'learned');
  const eight = [...classic, ['writing', true, 5], ['classic', true, 6]];
  assert.equal(statusOf(run(eight, { learnedStreak: 8 }).stats), 'learning', 'seven of eight');
  assert.equal(runIsLearned({ n: 5, y: `${day(0)},${day(1)},${day(2)}`, o: 1 }), true);
  assert.equal(runIsLearned({ n: 5, y: `${day(0)},${day(0)},${day(1)}`, o: 1 }), false, 'the same day twice is one day');
  assert.equal(runIsLearned({}), false);
});

test('a wrong answer ends the run; a wrong answer to a learned word takes "learned" away and brings it back soon', () => {
  const broken = run([['writing', true, 0], ['classic', true, 1], ['classic', false, 2], ['classic', true, 2], ['classic', true, 3]]);
  assert.deepEqual([broken.stats.n, broken.stats.y], [2, `${day(2)},${day(3)}`], 'the run starts again after the wrong answer');
  assert.equal(statusOf(broken.stats), 'learning');

  const learned = run([['writing', true, 0], ['classic', true, 0], ['classic', true, 1], ['classic', true, 1], ['classic', true, 2]]);
  const wrong = run([['classic', false, 40]], {}, learned.stats);
  assert.equal(wrong.last.unlearned, true);
  assert.notEqual(statusOf(wrong.stats), 'learned');
  assert.ok(!wrong.stats.g && !wrong.stats.n && !wrong.stats.y && !wrong.stats.o);
  assert.equal(wrong.stats.i, TUNING.RELEARN_MINUTES, 'asked again in minutes, not in a month');
  // and it has to be earned again, over several days
  const again = run([['writing', true, 41], ['classic', true, 41], ['classic', true, 41], ['classic', true, 41], ['classic', true, 41]], {}, wrong.stats);
  assert.equal(statusOf(again.stats), 'learning');
});

test('a learned word stays learned through right answers, also slow ones, and its gap never falls under thirty days', () => {
  const learned = run([['writing', true, 0], ['classic', true, 0], ['classic', true, 1], ['classic', true, 1], ['classic', true, 2]]);
  const slow = applyAnswer(learned.stats, { quality: 2, correct: true, mode: 'classic' }, T0 + 40 * DAY_MS, undefined, { day: day(40) });
  assert.equal(statusOf(slow.stats), 'learned');
  assert.ok(slow.stats.i >= TUNING.LEARNED_MIN_GAP_MINUTES);
  assert.equal(slow.stats.g, learned.stats.g, 'the date it was learned on stays');
  assert.equal(slow.learnedNow, false);
});

test('a right answer with a hint is right, but not part of the run', () => {
  const hinted = run([['writing', true, 0], ['classic', true, 1], ['writing', true, 2, true]]);
  assert.deepEqual([hinted.stats.n, hinted.stats.k, hinted.stats.w1], [2, 3, 2], 'counted as right, the run stays at two');
  assert.equal(hinted.stats.y, `${day(0)},${day(1)}`);
});

test('each way of asking keeps its own count; the state of the word is one', () => {
  const { stats } = run([['classic', true, 0], ['classic', false, 0], ['writing', true, 1], ['writing', false, 1], ['writing', true, 2], ['listening', true, 2]]);
  assert.deepEqual([stats.c1, stats.c0, stats.w1, stats.w0, stats.l1, stats.l0], [1, 1, 2, 1, 1, undefined], 'a count that is zero is not kept');
  assert.deepEqual([stats.a, stats.k, stats.l], [6, 4, 2]);
  assert.equal(typeof stats.i, 'number');
});

test('typing a word right is worth more than picking it: the next gap is longer', () => {
  const gapAfter = (mode) => run([[mode, true, 0], [mode, true, 1]]).stats.i;
  assert.ok(gapAfter('writing') > gapAfter('listening') && gapAfter('listening') > gapAfter('classic'), [gapAfter('classic'), gapAfter('listening'), gapAfter('writing')].join(' '));
  assert.equal(gapAfter('classic'), 1440);
  assert.equal(run([['writing', false, 0]]).stats.i, TUNING.RELEARN_MINUTES, 'a wrong answer is a wrong answer in every mode');
});

test('how an answer is rated, by the way it was asked', () => {
  assert.equal(qualityOf({ correct: true, ms: 1000, mode: 'classic' }, 4000), 5, 'classic: by speed, as before');
  assert.equal(qualityOf({ correct: true, ms: 90_000, mode: 'writing' }, 4000), 4, 'typing is not timed');
  assert.equal(qualityOf({ correct: true, mode: 'listening' }, 4000), 4);
  assert.equal(qualityOf({ correct: true, mode: 'writing', hints: 1, letters: 6 }, 4000), 3, 'a hint: partly right');
  assert.equal(qualityOf({ correct: true, mode: 'writing', hints: 3, letters: 6 }, 4000), 2, 'half the letters given away: asked again soon');
  assert.equal(qualityOf({ correct: false, mode: 'writing' }, 4000), 1);
  assert.equal(qualityOf({ unknown: true, mode: 'listening' }, 4000), 0);
});

// --- stored, synchronised, exported ---

const WORD = { text: 'blue', translation: 'mavi', sourceLang: 'en', targetLang: 'tr' };
const ID = 'en|tr|blue';
let device;
beforeEach(() => {
  device = use(createDevice('device', { uiLanguage: 'tr' }));
});

/** Answers the stored word through the real path, on the given days. */
async function answerOn(t, answers) {
  for (const [mode, correct, dayIndex, hints = 0] of answers) {
    t.mock.timers.setTime(T0 + dayIndex * DAY_MS + 12 * 3_600_000);
    await recordAnswer({ id: ID, outcome: 'answer', correct, mode, hints, letters: 4, ms: 3000, chars: 20 });
  }
}
const LEARNING_RUN = [['writing', true, 0], ['classic', true, 0], ['classic', true, 1], ['listening', true, 1], ['classic', true, 2]];

test('the learned state is part of the vault entry: stored, with a new revision, and reported when it happens', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  await addEntry(WORD);
  await answerOn(t, LEARNING_RUN.slice(0, 4));
  assert.equal((await getEntry(ID)).quiz.g, undefined);
  t.mock.timers.setTime(T0 + 2 * DAY_MS + 12 * 3_600_000);
  const result = await recordAnswer({ id: ID, outcome: 'answer', correct: true, mode: 'classic', ms: 3000, chars: 20 });
  assert.equal(result.status, 'learned');
  assert.equal(result.learnedNow, true);
  const entry = await getEntry(ID);
  assert.equal(entry.quiz.g, Date.now());
  assert.deepEqual([entry.quiz.c1, entry.quiz.w1, entry.quiz.l1, entry.rev], [3, 1, 1, 6]);
  assert.ok(entry.dueAt >= Date.now() + 30 * DAY_MS);

  t.mock.timers.setTime(T0 + 40 * DAY_MS);
  const wrong = await recordAnswer({ id: ID, outcome: 'answer', correct: false, mode: 'classic', ms: 3000, chars: 20 });
  assert.equal(wrong.unlearned, true);
  assert.equal((await getEntry(ID)).dueAt, Date.now() + TUNING.RELEARN_MINUTES * 60_000);
});

test('the number of right answers in a row comes from the settings', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  await updateSettings({ quizLearnedStreak: 3, quizLearnedNeedsOtherMode: false });
  await addEntry(WORD);
  await answerOn(t, [['classic', true, 0], ['classic', true, 1], ['classic', true, 2]]);
  assert.ok((await getEntry(ID)).quiz.g > 0);
});

test('learned travels with the word between devices, and loses to a later wrong answer by the usual rule', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const a = createDevice('A', { uiLanguage: 'tr' });
  const b = createDevice('B', { uiLanguage: 'tr' });
  const exchange = async () => {
    use(a);
    const fromA = await readLocalDocument();
    use(b);
    const merged = mergeDocuments(fromA, await readLocalDocument());
    await applyDocument(merged);
    use(a);
    await applyDocument(merged);
    return merged;
  };
  use(a);
  await addEntry(WORD);
  await answerOn(t, LEARNING_RUN);
  let merged = await exchange();
  assert.equal(merged.v, SCHEMA_VERSION);
  assert.ok(merged.e[ID].q.g > 0);
  assert.deepEqual(normalizeDocument(JSON.parse(serializeDocument(merged))), merged, 'the document passes the checks for incoming documents');
  use(b);
  assert.equal(statusOf((await getEntry(ID)).quiz), 'learned', 'B knows the word is learned');
  assert.deepEqual((await getEntry(ID)).quiz, merged.e[ID].q);

  // B gets it wrong later: a newer revision, which wins on both devices.
  t.mock.timers.setTime(T0 + 50 * DAY_MS);
  await recordAnswer({ id: ID, outcome: 'answer', correct: false, mode: 'writing' });
  merged = await exchange();
  use(a);
  assert.notEqual(statusOf((await getEntry(ID)).quiz), 'learned', 'A learns of it');
  assert.equal((await getEntry(ID)).quiz.w0, 1);
});

test('learned is in the JSON export and comes back with the import', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  await addEntry(WORD);
  await answerOn(t, LEARNING_RUN);
  const file = JSON.stringify(await createBackup());
  assert.equal(JSON.parse(file).version, 2);
  use(createDevice('other'));
  assert.deepEqual(await restoreBackup(file), { added: 1, skipped: 0, invalid: 0 });
  const [entry] = await listEntries();
  assert.equal(statusOf(entry.quiz), 'learned');
  assert.deepEqual([entry.quiz.n, entry.quiz.o, entry.quiz.w1, entry.quiz.l1], [5, 2, 1, 1]);
});

// --- data written before all this ---

const OLD_ENTRY = { id: ID, ...WORD, alternatives: [], sentence: 'The sky is blue.', url: 'https://example.com/', title: 'Example', createdAt: T0 - 90 * DAY_MS, updatedAt: T0 - 30 * DAY_MS, rev: 7, box: 3, dueAt: T0 + 5 * DAY_MS, quiz: { a: 9, k: 8, s: 6, e: 2.7, i: 10_080, l: 1, m: 3200, d: 0.18, x: T0 - 2 * DAY_MS }, dictionary: null };

test('migration: data of schema 1 is kept as it is, and the version is noted', async () => {
  await chrome.storage.local.set({ [`vault:${ID}`]: structuredClone(OLD_ENTRY), settings: { targetLang: 'tr' } });
  assert.deepEqual(await ensureSchema(), { from: 1, to: LOCAL_SCHEMA });
  assert.deepEqual((await chrome.storage.local.get(`vault:${ID}`))[`vault:${ID}`], OLD_ENTRY, 'not a byte of the word changed: no new revision, no new date');
  assert.equal((await chrome.storage.local.get('schemaVersion')).schemaVersion, 2);
  assert.deepEqual(await ensureSchema(), { from: 2, to: 2 }, 'running it again does nothing');
  await chrome.storage.local.set({ schemaVersion: 9 });
  assert.deepEqual(await ensureSchema(), { from: 9, to: 9 }, 'data of a newer version is not marked down');
});

test('migration: an old word is a word without a run: not learned, whatever its gap, until it earns it', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  await chrome.storage.local.set({ [`vault:${ID}`]: structuredClone(OLD_ENTRY) });
  await ensureSchema();
  const before = await getEntry(ID);
  assert.equal(statusOf(before.quiz), 'learning', 'a week-long gap used to be called learned; it is not any more');
  assert.deepEqual(normalizeStats(before.quiz), OLD_ENTRY.quiz, 'the old summary is well-formed as it stands');

  await answerOn(t, [['classic', true, 0]]);
  const after = await getEntry(ID);
  assert.deepEqual([after.quiz.a, after.quiz.k, after.quiz.n, after.quiz.c1, after.rev], [10, 9, 1, 1, 8], 'the old numbers go on, the new ones start');
  assert.equal(after.sentence, 'The sky is blue.');
  await answerOn(t, [['writing', true, 0], ['classic', true, 1], ['classic', true, 1], ['classic', true, 2]]);
  assert.equal(statusOf((await getEntry(ID)).quiz), 'learned');
});

test('migration: a synchronised document of version 1 is read; what is written back is version 2', async () => {
  const v1 = { v: 1, e: { [ID]: { w: 'blue', t: 'mavi', sl: 'en', tl: 'tr', u: T0, r: 3, b: 2, n: T0 + DAY_MS, q: { a: 4, k: 4, s: 4, e: 2.5, i: 4320, l: 0, m: 3000, d: 0.1, x: T0 } } } };
  const document = normalizeDocument(v1);
  assert.equal(document.v, 2);
  assert.deepEqual(document.e, v1.e, 'the records are untouched');
  await applyDocument(document);
  const back = await readLocalDocument();
  assert.deepEqual(back.e[ID], v1.e[ID], 'and go back out as they came in: the new fields are only there when they say something');
  assert.equal(back.v, 2);
  assert.ok(!('s' in back), 'no streak yet: no streak section');
});

test('migration: a backup file of version 1 is imported as before', async () => {
  const file = JSON.stringify({ format: 'wordvault-backup', version: 1, entries: [OLD_ENTRY] });
  assert.deepEqual(await restoreBackup(file), { added: 1, skipped: 0, invalid: 0 });
  assert.deepEqual((await getEntry(ID)).quiz, OLD_ENTRY.quiz);
});
