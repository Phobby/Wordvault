// The four levels of difficulty: the selector in the toolbar popup (its round and its memory),
// which also sets how the quiz that comes by itself asks, the expert question, and a quiz
// started by hand.

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { updateSettings } from '../src/lib/settings.js';
import { addEntry, getEntry } from '../src/lib/vault.js';
import { DEFAULT_DIFFICULTY, DIFFICULTIES, difficultyOf, getDifficulty, nextDifficulty, setDifficulty } from '../src/quiz/difficulty.js';
import { MODES } from '../src/quiz/learning.js';
import { expertQuestion, questionInMode } from '../src/quiz/question.js';
import { answerQuestion, automaticMode, claimSession, qualityOf, recordAnswer, startManualQuiz } from '../src/quiz/scheduler.js';
import { readSession } from '../src/quiz/session.js';
import { streakStatus } from '../src/quiz/streak.js';
import { createDevice, use } from './helpers/chrome.js';
import { loadScripts } from './helpers/hover.js';

const { quizAnswers } = loadScripts(['shared/quiz-answers.js']);

let device;
beforeEach(() => {
  device = use(createDevice('device', { uiLanguage: 'tr' }));
});
const WORDS = ['blue:mavi', 'door:kapı', 'tree:ağaç', 'water:su', 'house:ev', 'bread:ekmek', 'road:yol', 'sea:deniz'];
const fill = async (count = WORDS.length) => {
  for (const pair of WORDS.slice(0, count)) {
    const [text, translation] = pair.split(':');
    await addEntry({ text, translation, sourceLang: 'en', targetLang: 'tr' });
  }
  await updateSettings({ targetLang: 'tr' });
};

// --- the selector ---

test('the levels: easy, medium, hard, expert, each one way of asking', () => {
  assert.deepEqual(DIFFICULTIES.map((level) => [level.id, level.mode]), [['easy', 'classic'], ['medium', 'writing'], ['hard', 'listening'], ['expert', 'expert']]);
  assert.deepEqual(DIFFICULTIES.map((level) => level.mode), [...MODES], 'in the order of the ways, which is the order of the weights');
  assert.equal(new Set(DIFFICULTIES.map((level) => level.theme)).size, 4, 'each has a drawing of its own');
});

test('a click goes to the next level, and from expert back to easy', () => {
  const round = [];
  let level = difficultyOf('easy');
  for (let click = 0; click < 9; click++) {
    level = nextDifficulty(level.id);
    round.push(level.id);
  }
  assert.deepEqual(round, ['medium', 'hard', 'expert', 'easy', 'medium', 'hard', 'expert', 'easy', 'medium']);
  assert.equal(nextDifficulty('nonsense').id, 'medium', 'an unknown level counts as the first');
  assert.equal(difficultyOf('nonsense').id, 'easy');
  assert.equal(difficultyOf(undefined).id, DEFAULT_DIFFICULTY);
});

test('the chosen level is remembered on this device, across restarts', async () => {
  assert.equal((await getDifficulty()).id, 'easy', 'nothing chosen yet');
  assert.equal((await setDifficulty('hard')).id, 'hard');
  assert.deepEqual(await chrome.storage.local.get('quizDifficulty'), { quizDifficulty: 'hard' });
  device.restartBrowser();
  assert.equal((await getDifficulty()).id, 'hard');
  // many quick clicks: what is stored is where the last one landed
  let level = await getDifficulty();
  const writes = [];
  for (let click = 0; click < 7; click++) {
    level = nextDifficulty(level.id);
    writes.push(setDifficulty(level.id));
  }
  await Promise.all(writes);
  assert.equal((await getDifficulty()).id, level.id);
  await chrome.storage.local.set({ quizDifficulty: 'broken' });
  assert.equal((await getDifficulty()).id, 'easy');
  assert.equal((await setDifficulty('broken')).id, 'easy', 'only a real level is stored');
});

test('the level is not a setting: it is not synchronised, exported or reset with the quiz settings', async () => {
  await setDifficulty('expert');
  await updateSettings({ quizDailyGoal: 4 });
  assert.ok(!JSON.stringify((await chrome.storage.local.get('settings')).settings).includes('expert'));
  assert.deepEqual(await chrome.storage.sync.get(null), {});
});

// --- the quiz that comes by itself ---

test('the quiz that comes by itself asks at the level chosen in the toolbar popup', async () => {
  assert.equal(await automaticMode(), 'classic', 'nothing chosen: easy');
  for (const level of DIFFICULTIES) {
    await setDifficulty(level.id);
    assert.equal(await automaticMode(), level.mode);
  }
});

// --- expert: heard and typed ---

const card = (text, translation, more = {}) => ({ id: `en|tr|${text.toLowerCase()}`, text, translation, sourceLang: 'en', targetLang: 'tr', alternatives: [], ...more });

test('expert question: the word is carried to be said and to be typed; its meaning only for afterwards', () => {
  assert.deepEqual(expertQuestion(card('blue', 'mavi')), { mode: 'expert', id: 'en|tr|blue', word: 'blue', answer: 'blue', accept: ['blue'], meaning: 'mavi', sourceLang: 'en', targetLang: 'tr', letters: 4, chars: 8 });
  assert.equal(expertQuestion(card('blue', 'mavi', { sourceLang: '' })), null, 'no language to say it in');
  assert.equal(expertQuestion(card('x'.repeat(41), 'uzun')), null, 'too long to type from hearing');
  assert.deepEqual(expertQuestion(card('big', 'büyük')).accept, ['big'], 'only what was said is right, not another word with the same meaning');
  assert.equal(questionInMode(card('blue', 'mavi'), [card('blue', 'mavi')], 'expert', Math.random, { allowed: ['expert'] }).mode, 'expert', 'one word is enough: nothing to choose from');
  assert.equal(questionInMode(card('blue', 'mavi'), [card('blue', 'mavi')], 'expert', Math.random, { allowed: ['expert'], without: ['listening', 'expert'] }), null);
});

test('expert answers are checked like written ones: case, spaces, Unicode form; accents by the setting', () => {
  const { isCorrect, hintMask } = quizAnswers;
  assert.equal(isCorrect('  BLUE ', ['blue']), true);
  assert.equal(isCorrect('blu', ['blue']), false, 'a spelling mistake is wrong');
  assert.equal(isCorrect('cafe', ['café']), false);
  assert.equal(isCorrect('cafe', ['café'], { accentTolerant: true }), true);
  assert.equal(isCorrect('IŞIK', ['ışık'], { lang: 'tr' }), true);
  assert.equal(hintMask('blue', 2), 'b l _ _');
});

test('hints and "Skip" lower the score, in writing and in expert alike', () => {
  for (const mode of ['writing', 'expert']) {
    assert.equal(qualityOf({ correct: true, mode }, 4000), 4, `${mode}: right`);
    assert.equal(qualityOf({ correct: true, mode, hints: 1, letters: 6 }, 4000), 3, `${mode}: one hint, partly right`);
    assert.equal(qualityOf({ correct: true, mode, hints: 3, letters: 6 }, 4000), 2, `${mode}: half the letters given away`);
    assert.equal(qualityOf({ correct: false, mode, hints: 2, letters: 6 }, 4000), 1, `${mode}: wrong`);
    assert.equal(qualityOf({ unknown: true, mode }, 4000), 0, `${mode}: skipped`);
  }
});

test('an expert answer is recorded under expert, weighs the most, and counts for "learned" as a level above easy', async () => {
  await fill();
  const id = 'en|tr|blue';
  await recordAnswer({ id, outcome: 'answer', mode: 'expert', correct: true, hints: 0, letters: 4, ms: 5000 });
  let entry = await getEntry(id);
  assert.deepEqual([entry.quiz.x1, entry.quiz.n, entry.quiz.o, entry.quiz.c1], [1, 1, 1, undefined]);
  assert.ok(entry.quiz.x > 1e12, 'the time of the last answer is still its own field');
  await recordAnswer({ id, outcome: 'unknown', mode: 'expert', hints: 1, letters: 4 });
  entry = await getEntry(id);
  assert.deepEqual([entry.quiz.x0, entry.quiz.n, entry.quiz.l], [1, undefined, 1], '"Skip" is a wrong answer');
});

// --- a quiz started by hand ---

test('a quiz started by hand asks in the chosen way only, even with the timed quiz switched off', async () => {
  await fill();
  await updateSettings({ quizEnabled: false });
  for (const level of DIFFICULTIES) {
    const started = await startManualQuiz({ mode: level.mode });
    assert.deepEqual([started.ok, started.reason, started.here], [true, 'shown', true], level.id);
    const session = await readSession();
    assert.equal(session.question.mode, level.mode, level.id);
    assert.equal(session.mode, level.mode);
    assert.equal(session.offeredTo, 'popup', 'the popup that asked shows it itself');
    assert.equal(session.total, 5, 'as many questions as the daily goal');
  }
});

test('every question of it stays in that way, and it fills the day for the streak', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 9, 13, 12).getTime() });
  await fill();
  await updateSettings({ quizDailyGoal: 3 });
  assert.equal((await startManualQuiz({ mode: 'writing' })).ok, true);
  const view = await claimSession({ surface: 'popup' });
  assert.equal(view.total, 3);
  let question = view.question;
  for (let index = 0; index < 3; index++) {
    assert.equal(question.mode, 'writing', `question ${index + 1}`);
    const reply = await answerQuestion({ sessionId: view.sessionId, id: question.id, outcome: 'answer', mode: 'writing', correct: true, hints: 0, letters: question.letters, ms: 4000 });
    question = reply.next?.question;
    if (index === 2) assert.deepEqual(reply.summary, { right: 3, answered: 3, skipped: 0, asked: 3, total: 3 });
  }
  const streak = await streakStatus(Date.now(), { quizDailyGoal: 3 });
  assert.deepEqual([streak.todayDone, streak.count, streak.answered], [true, 1, 3], 'a quiz started by hand counts like any other');
});

test('too few words: it says which level cannot be asked, and why', async () => {
  let started = await startManualQuiz({ mode: 'classic' });
  assert.deepEqual([started.ok, started.reason], [false, 'no_cards'], 'an empty vault');
  await fill(3);
  started = await startManualQuiz({ mode: 'classic' });
  assert.deepEqual([started.ok, started.reason, started.needed, started.have], [false, 'not_enough_choices', 4, 3], 'three meanings, four needed');
  assert.equal((await startManualQuiz({ mode: 'listening' })).reason, 'not_enough_choices');
  assert.equal(await readSession(), null, 'nothing is left half-started');
  // typing needs no choices: three words are plenty
  assert.equal((await startManualQuiz({ mode: 'writing' })).ok, true);
  assert.equal((await startManualQuiz({ mode: 'expert' })).ok, true);
});

test('a language this device cannot say: the listening levels say so instead of starting', async () => {
  await fill();
  await chrome.storage.local.set({ quizState: { noVoice: { en: Date.now() + 3_600_000 } } });
  assert.equal((await startManualQuiz({ mode: 'listening' })).reason, 'no_voice');
  assert.equal((await startManualQuiz({ mode: 'expert' })).reason, 'no_voice');
  assert.equal((await startManualQuiz({ mode: 'classic' })).ok, true);
});

test('with the quiz set to appear as a card or a window, a quiz started by hand goes there', async () => {
  await fill();
  await updateSettings({ quizDisplay: 'card' });
  device.browser.page = { supported: true, blocked: 'video_playing' };
  const started = await startManualQuiz({ mode: 'classic' });
  assert.deepEqual([started.ok, started.method, started.here], [true, 'card', false], 'started by hand: shown whatever the moment is like');
  // a page that cannot show a card: the popup shows it after all
  await chrome.storage.local.remove('quizSession');
  device.browser.page = { supported: false, blocked: '' };
  device.browser.can.window = false;
  const fallback = await startManualQuiz({ mode: 'classic' });
  assert.deepEqual([fallback.ok, fallback.here], [true, true]);
});
