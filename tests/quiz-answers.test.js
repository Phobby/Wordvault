// From an answer to the vault: statistics, next date, revision; and how they synchronise.

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { updateSettings } from '../src/lib/settings.js';
import { addEntry, getEntry, removeEntry } from '../src/lib/vault.js';
import { TUNING } from '../src/quiz/learning.js';
import { getDiagnostics, getQuizState, recordAnswer, showQuiz, testQuiz } from '../src/quiz/scheduler.js';
import { applyDocument, readLocalDocument } from '../src/sync/local.js';
import { mergeDocuments, serializeDocument } from '../src/sync/merge.js';
import { normalizeDocument } from '../src/sync/model.js';
import { createDevice, use } from './helpers/chrome.js';

const T0 = 1_790_000_000_000;
const MINUTE = 60_000;
const DAY = 1440 * MINUTE;
const WORDS = ['book:kitap', 'door:kapı', 'tree:ağaç', 'water:su', 'house:ev', 'bread:ekmek', 'road:yol', 'sea:deniz', 'bird:kuş', 'cloud:bulut', 'stone:taş', 'star:yıldız'];
const ID = 'en|tr|book';

let device;
beforeEach(async (t) => {
  device = use(createDevice('device', { uiLanguage: 'tr' }));
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
});
const at = (t, time) => t.mock.timers.setTime(time);
const fill = async (count = WORDS.length) => {
  for (const pair of WORDS.slice(0, count)) {
    const [text, translation] = pair.split(':');
    await addEntry({ text, translation, sourceLang: 'en', targetLang: 'tr' });
  }
};

test('a right answer is stored with the word: statistics, next date, a new revision', async (t) => {
  await fill();
  at(t, T0 + 5 * MINUTE);
  const result = await recordAnswer({ id: ID, correct: true, ms: 4000, chars: 20 });
  assert.deepEqual(result, { quality: 4, dueAt: T0 + 15 * MINUTE, status: 'learning' });
  const entry = await getEntry(ID);
  assert.deepEqual(entry.quiz, { a: 1, k: 1, s: 1, e: 2.5, i: 10, l: 0, m: 4000, d: entry.quiz.d, x: T0 + 5 * MINUTE });
  assert.deepEqual([entry.dueAt, entry.box, entry.rev, entry.updatedAt], [T0 + 15 * MINUTE, 0, 2, T0 + 5 * MINUTE]);
  assert.deepEqual((await getQuizState()).lastAnswer, { at: T0 + 5 * MINUTE, id: ID, outcome: 'answer', correct: true, quality: 4 });

  at(t, T0 + 20 * MINUTE);
  await recordAnswer({ id: ID, correct: true, ms: 1500, chars: 20 });
  const again = await getEntry(ID);
  assert.deepEqual([again.quiz.a, again.quiz.s, again.quiz.e, again.box, again.rev], [2, 2, 2.6, 1, 3]);
  assert.equal(again.dueAt, T0 + 20 * MINUTE + Math.round(1440 * 1.4) * MINUTE, 'a fast answer: 1.4 days instead of 1');
});

test('wrong, "I don\'t know", and the ways of not answering', async (t) => {
  await fill();
  let result = await recordAnswer({ id: ID, correct: false, ms: 2000, chars: 20 });
  assert.deepEqual([result.quality, result.dueAt], [1, T0 + TUNING.RELEARN_MINUTES * MINUTE]);
  assert.deepEqual([(await getEntry(ID)).quiz.l, (await getEntry(ID)).quiz.e], [1, 2.3]);

  // "I don't know" is a wrong answer, whatever else the card sends along; the time it took to
  // give up is not an answer time.
  result = await recordAnswer({ id: 'en|tr|door', outcome: 'unknown', correct: true, ms: 900, chars: 20 });
  assert.equal(result.quality, 0);
  const gaveUp = await getEntry('en|tr|door');
  assert.deepEqual([gaveUp.quiz.a, gaveUp.quiz.k, gaveUp.quiz.l, gaveUp.quiz.m, gaveUp.quiz.e], [1, 0, 1, 0, 2.3]);
  assert.equal(gaveUp.dueAt, T0 + TUNING.RELEARN_MINUTES * MINUTE);
  assert.deepEqual((await getQuizState()).lastAnswer, { at: T0, id: 'en|tr|door', outcome: 'unknown', correct: false, quality: 0 });
  assert.deepEqual((await getQuizState()).speed, [], 'and it says nothing about the pace');

  for (const [index, outcome] of ['later', 'timeout', 'closed'].entries()) {
    const id = `en|tr|${['tree', 'water', 'house'][index]}`;
    at(t, T0 + index);
    result = await recordAnswer({ id, outcome, correct: true, ms: 100 });
    const entry = await getEntry(id);
    assert.equal(result.quality, null, outcome);
    assert.equal(entry.quiz, null, `${outcome}: nothing is held against the word; it has still never been answered`);
    assert.equal(entry.dueAt, T0 + index + TUNING.POSTPONE_MINUTES * MINUTE, `${outcome}: it comes back shortly`);
    assert.equal(result.status, 'new');
  }
});

test('answers about a word that is gone, or about nothing, are ignored', async () => {
  await fill();
  await removeEntry(ID);
  assert.equal(await recordAnswer({ id: ID, correct: true, ms: 1000 }), null);
  assert.equal(await recordAnswer({}), null);
  assert.equal(await recordAnswer(null), null);
  assert.equal(await getEntry(ID), null);
});

test('the user\'s pace is learned from right answers only and stays on the device', async () => {
  await fill();
  for (const [index, pair] of WORDS.slice(0, 6).entries()) {
    await recordAnswer({ id: `en|tr|${pair.split(':')[0]}`, correct: true, ms: 2000 + index, chars: 40 });
  }
  await recordAnswer({ id: 'en|tr|road', correct: false, ms: 50, chars: 40 });
  await recordAnswer({ id: 'en|tr|sea', outcome: 'later', ms: 50 });
  const state = await getQuizState();
  assert.deepEqual(state.speed, [2000, 2001, 2002, 2003, 2004, 2005]);
  // four seconds is now slow for this user
  const result = await recordAnswer({ id: 'en|tr|bird', correct: true, ms: 4000, chars: 40 });
  assert.equal(result.quality, 3);
  const text = serializeDocument(await readLocalDocument());
  assert.ok(!text.includes('speed') && !text.includes('recent') && !text.includes('quizState'), 'the pace and the timer state are not part of the synchronised document');
});

test('quizzes ask different words in a row and remember what they asked', async () => {
  await fill();
  const asked = [];
  for (let round = 0; round < 40; round++) {
    assert.equal((await showQuiz()).reason, 'shown');
    asked.push(device.browser.sent.at(-1).message.payload.id);
  }
  for (let index = 1; index < asked.length; index++) {
    assert.ok(!asked.slice(Math.max(0, index - 3), index).includes(asked[index]), `question ${index} repeats one of the three before it`);
  }
  assert.deepEqual((await getQuizState()).recent, asked.slice(-5));
  // a quiz that was not shown asked nothing
  device.browser.reply = () => ({ shown: false, reason: 'typing' });
  await showQuiz();
  assert.deepEqual((await getQuizState()).recent, asked.slice(-5));
  // "Test now" follows the same rule
  device.browser.reply = () => ({ shown: true });
  assert.deepEqual(await testQuiz(), { ok: true });
  const tested = device.browser.sent.at(-1).message.payload.id;
  assert.ok(!asked.slice(-3).includes(tested));
  assert.equal((await getQuizState()).recent.at(-1), tested);
});

test('words answered wrongly come up more often than words that are known', async (t) => {
  await fill();
  const hard = ['en|tr|book', 'en|tr|door'];
  let now = T0;
  // Every word has been answered a few times: two of them badly, the rest well.
  for (const pair of WORDS) {
    const id = `en|tr|${pair.split(':')[0]}`;
    for (const correct of hard.includes(id) ? [false, false, true, false] : [true, true, true, true]) {
      now += MINUTE;
      at(t, now);
      await recordAnswer({ id, correct, ms: 4000, chars: 20 });
    }
  }
  // Much later everything is due again.
  at(t, now + 400 * DAY);
  const counts = {};
  for (let round = 0; round < 600; round++) {
    await showQuiz();
    const id = device.browser.sent.at(-1).message.payload.id;
    counts[id] = (counts[id] || 0) + 1;
  }
  const hardAverage = (counts[hard[0]] + counts[hard[1]]) / 2;
  const easyAverage = WORDS.map((pair) => `en|tr|${pair.split(':')[0]}`).filter((id) => !hard.includes(id)).reduce((sum, id) => sum + (counts[id] || 0), 0) / 10;
  assert.ok(hardAverage > easyAverage * 1.5, `hard ${hardAverage} vs easy ${easyAverage}`);
});

test('nothing due: by default the hardest word is asked early; switched off, no quiz comes', async (t) => {
  await fill();
  for (const pair of WORDS) await recordAnswer({ id: `en|tr|${pair.split(':')[0]}`, correct: true, ms: 4000, chars: 20 });
  await recordAnswer({ id: ID, correct: false, ms: 4000, chars: 20 });
  at(t, T0 + MINUTE); // everything was answered a minute ago; the earliest is due in nine minutes
  assert.equal((await getDiagnostics()).due, 0);
  assert.equal((await showQuiz()).reason, 'shown');
  assert.equal(device.browser.sent.at(-1).message.payload.id, ID, 'the hardest word');

  await updateSettings({ quizAllowNotDue: false });
  const before = device.browser.sent.length;
  assert.equal((await showQuiz()).reason, 'nothing_due');
  assert.equal(device.browser.sent.length, before);
  assert.equal((await getDiagnostics()).standingReason, 'nothing_due');
  assert.equal((await testQuiz()).ok, true, '"Test now" still shows one');

  at(t, T0 + 11 * MINUTE);
  assert.equal((await getDiagnostics()).due, 12);
  assert.equal((await showQuiz()).reason, 'shown');
});

test('statistics synchronise with the word and merge by the usual rule', async (t) => {
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
  await addEntry({ text: 'book', translation: 'kitap', sourceLang: 'en', targetLang: 'tr' });
  await recordAnswer({ id: ID, correct: true, ms: 4000, chars: 20 });
  let merged = await exchange();
  assert.deepEqual(merged.e[ID].q, { a: 1, k: 1, s: 1, e: 2.5, i: 10, l: 0, m: 4000, d: merged.e[ID].q.d, x: T0 });
  assert.deepEqual(normalizeDocument(JSON.parse(serializeDocument(merged))), merged, 'the document with statistics passes the checks for incoming documents');
  use(b);
  assert.deepEqual((await getEntry(ID)).quiz, merged.e[ID].q, 'B knows how A answered');
  assert.equal((await getEntry(ID)).dueAt, T0 + 10 * MINUTE);

  // B answers later, having seen A's answer: B's statistics continue A's and win.
  at(t, T0 + 20 * MINUTE);
  await recordAnswer({ id: ID, correct: false, ms: 3000, chars: 20 });
  merged = await exchange();
  use(a);
  const onA = await getEntry(ID);
  assert.deepEqual([onA.quiz.a, onA.quiz.k, onA.quiz.l, onA.rev], [2, 1, 1, 3]);

  // Both answer without synchronising in between: the later answer's record wins as a whole.
  at(t, T0 + 30 * MINUTE);
  await recordAnswer({ id: ID, correct: true, ms: 4000, chars: 20 }); // on A
  use(b);
  at(t, T0 + 31 * MINUTE);
  await recordAnswer({ id: ID, correct: false, ms: 4000, chars: 20 });
  merged = await exchange();
  assert.equal(merged.e[ID].q.l, 2, "B's later answer");
  use(a);
  assert.equal((await getEntry(ID)).quiz.l, 2);
  assert.equal(serializeDocument(await readLocalDocument()), serializeDocument(merged));
  // and applying again changes nothing
  assert.deepEqual(await applyDocument(merged), { added: 0, updated: 0, removed: 0 });
});

test('statistics fields from a newer version survive synchronisation', async () => {
  await addEntry({ text: 'book', translation: 'kitap', sourceLang: 'en', targetLang: 'tr' });
  const remote = { v: 1, e: { [ID]: { w: 'book', t: 'kitap', sl: 'en', tl: 'tr', u: T0 + 10, r: 5, n: T0 + DAY, q: { a: 3, k: 2, s: 1, e: 2.4, i: 1440, l: 1, m: 3500, d: 0.4, x: T0, zz: 9 } } } };
  const merged = mergeDocuments(await readLocalDocument(), remote);
  await applyDocument(merged);
  assert.equal((await getEntry(ID)).quiz.zz, 9);
  assert.equal(serializeDocument(await readLocalDocument()), serializeDocument(merged), 'what goes back out is what came in');
  assert.deepEqual(await applyDocument(merged), { added: 0, updated: 0, removed: 0 });
});
