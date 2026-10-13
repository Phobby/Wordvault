// The three ways a word is asked: typed answers (normalising, accents, hints, the comparison),
// the questions built for writing and listening, which way is chosen, and a word that cannot
// be said aloud.

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { updateSettings } from '../src/lib/settings.js';
import { addEntry, getEntry } from '../src/lib/vault.js';
import { listeningQuestion, questionInMode, writingQuestion } from '../src/quiz/question.js';
import { answerQuestion, enabledModes, getQuizState, pickMode, recordAnswer, testQuiz } from '../src/quiz/scheduler.js';
import { readSession } from '../src/quiz/session.js';
import { createDevice, use } from './helpers/chrome.js';
import { loadScripts } from './helpers/hover.js';

const { quizAnswers } = loadScripts(['shared/quiz-answers.js']);
const { normalize, isCorrect, hintMask, letterCount, diff } = quizAnswers;

// --- typed answers ---

test('writing: case, spaces around and between, and Unicode form do not matter', () => {
  for (const typed of ['blue', 'Blue', 'BLUE', '  blue  ', 'blue ']) assert.equal(isCorrect(typed, ['blue']), true, JSON.stringify(typed));
  assert.equal(isCorrect('ice  cream', ['ice cream']), true);
  assert.equal(isCorrect('café', ['café']), true, 'a letter and its accent typed apart are the accented letter');
  assert.equal(isCorrect("don’t", ["don't"]), true, 'a typographic apostrophe is an apostrophe');
  assert.equal(isCorrect('blu', ['blue']), false);
  assert.equal(isCorrect('', ['blue']), false);
  assert.equal(isCorrect('   ', ['blue']), false);
  assert.equal(isCorrect('icecream', ['ice cream']), false, 'a missing space is a mistake');
});

test('writing: an accent that is missing is a spelling mistake, unless accents are tolerated', () => {
  for (const [typed, answer] of [['cafe', 'café'], ['uber', 'über'], ['nino', 'niño'], ['garcon', 'garçon'], ['resume', 'résumé']]) {
    assert.equal(isCorrect(typed, [answer]), false, `${typed} / ${answer}: strict`);
    assert.equal(isCorrect(typed, [answer], { accentTolerant: true }), true, `${typed} / ${answer}: tolerant`);
  }
  assert.equal(isCorrect('strasse', ['Straße'], { accentTolerant: true }), true);
  assert.equal(isCorrect('strasse', ['Straße']), false);
  assert.equal(isCorrect('cafx', ['café'], { accentTolerant: true }), false, 'tolerant of accents, not of other letters');
  assert.equal(normalize('ÉCOLE'), 'école');
  assert.equal(normalize('ÉCOLE', { accentTolerant: true }), 'ecole');
});

test('writing: Turkish İ/ı follow the language of the word', () => {
  assert.equal(isCorrect('IŞIK', ['ışık'], { lang: 'tr' }), true);
  assert.equal(isCorrect('İSTANBUL', ['istanbul'], { lang: 'tr' }), true);
  assert.equal(isCorrect('isik', ['ışık'], { lang: 'tr' }), false, 'ı and i are two letters');
  assert.equal(isCorrect('isik', ['ışık'], { lang: 'tr', accentTolerant: true }), true, 'unless accents are tolerated');
  assert.equal(isCorrect('ICE', ['ice'], { lang: 'en' }), true);
});

test('writing: every saved word with that meaning is accepted', () => {
  assert.equal(isCorrect('large', ['big', 'large']), true);
  assert.equal(isCorrect('huge', ['big', 'large']), false);
});

test('writing: a hint shows one more letter each time', () => {
  assert.equal(hintMask('blue', 0), '_ _ _ _');
  assert.equal(hintMask('blue', 1), 'b _ _ _');
  assert.equal(hintMask('blue', 3), 'b l u _');
  assert.equal(hintMask('ice cream', 2), 'i c _    _ _ _ _ _', 'the space between words is shown from the start');
  assert.equal(hintMask("don't", 3), "d o n ' _");
  assert.equal(letterCount('ice cream'), 8);
  assert.equal(letterCount("well-known"), 9);
  assert.equal(hintMask('écoute', 1), 'é _ _ _ _ _', 'a letter with an accent is one letter');
});

test('writing: the comparison marks the letters that were wrong or missing', () => {
  const marked = (typed, expected, options) => diff(typed, expected, options).map((part) => (part.ok ? part.char : `[${part.char}]`)).join('');
  assert.equal(marked('blue', 'blue'), 'blue');
  assert.equal(marked('bleu', 'blue'), 'blu[e]', 'two letters swapped: one of them is marked');
  assert.equal(marked('recieve', 'receive'), 'rece[i]ve');
  assert.equal(marked('blu', 'blue'), 'blu[e]', 'a letter missing at the end');
  assert.equal(marked('bluee', 'blue'), 'blue', 'a letter too many: nothing of the answer is wrong');
  assert.equal(marked('cafe', 'café'), 'caf[é]', 'the accent');
  assert.equal(marked('cafe', 'café', { accentTolerant: true }), 'café');
  assert.equal(marked('BLUE', 'blue'), 'blue', 'case is not a mistake');
  assert.equal(marked('xyz', 'blue'), '[b][l][u][e]');
  assert.equal(marked('', 'blue'), '[b][l][u][e]');
  assert.equal(diff('bleu', 'blue').map((part) => part.char).join(''), 'blue', 'what is shown is the right answer, whole');
});

// --- the questions ---

const card = (text, translation, more = {}) => ({ id: `en|tr|${text.toLowerCase()}`, text, translation, sourceLang: 'en', targetLang: 'tr', alternatives: [], ...more });
const CARDS = [card('blue', 'mavi'), card('door', 'kapı'), card('tree', 'ağaç'), card('water', 'su'), card('house', 'ev'), card('bread', 'ekmek'), card('big', 'büyük'), card('large', 'büyük')];
const seeded = () => {
  let state = 7;
  return () => ((state = (state * 16807) % 2147483647) - 1) / 2147483646;
};

test('writing question: the meaning is shown, the saved word is the answer', () => {
  const question = writingQuestion(CARDS[0], CARDS);
  assert.deepEqual(question, { mode: 'writing', id: 'en|tr|blue', word: 'mavi', answer: 'blue', accept: ['blue'], sourceLang: 'en', targetLang: 'tr', letters: 4, chars: 8 });
  assert.deepEqual(writingQuestion(CARDS[6], CARDS).accept, ['big', 'large'], 'two saved words with the same meaning: both are right');
  assert.equal(writingQuestion(card('x'.repeat(41), 'uzun'), CARDS), null, 'a sentence is not typed from memory');
  assert.equal(writingQuestion(card('blue', ''), CARDS), null);
});

test('listening question: the word is carried to be said, with four meanings or four spellings', () => {
  const meaning = listeningQuestion(CARDS[0], CARDS, seeded());
  assert.equal(meaning.mode, 'listening');
  assert.equal(meaning.word, 'blue');
  assert.equal(meaning.choices.length, 4);
  assert.equal(meaning.choices[meaning.answer], 'mavi');
  assert.equal(meaning.choiceKind, 'meaning');
  const spelling = listeningQuestion(CARDS[0], CARDS, seeded(), 'spelling');
  assert.equal(spelling.choices[spelling.answer], 'blue');
  assert.equal(new Set(spelling.choices).size, 4);
  assert.ok(spelling.choices.every((choice) => CARDS.some((other) => other.text === choice)), 'the wrong spellings are other saved words');
  const big = listeningQuestion(CARDS[6], CARDS, seeded(), 'spelling');
  assert.ok(!big.choices.includes('large'), 'a word with the same meaning is not offered as a wrong choice');
  assert.equal(listeningQuestion(card('blue', 'mavi', { sourceLang: '' }), CARDS, seeded()), null, 'no language, nothing to say it in');
  assert.equal(listeningQuestion(CARDS[0], CARDS.slice(0, 3), seeded()), null, 'too few other words');
});

test('a way that does not work for a word falls back to another that is switched on, never to one that is off', () => {
  const long = card('a sentence that is far too long to be typed from memory', 'uzun bir cümle');
  const all = [...CARDS, long];
  assert.equal(questionInMode(long, all, 'writing', seeded()).mode, 'classic');
  assert.equal(questionInMode(long, all, 'writing', seeded(), { allowed: ['writing'] }), null, 'only writing is on: this word is passed over');
  assert.equal(questionInMode(CARDS[0], CARDS, 'listening', seeded(), { without: ['listening'] }).mode, 'classic', 'no voice for it: asked another way');
  assert.equal(questionInMode(CARDS[0], CARDS, 'listening', seeded(), { allowed: ['listening', 'writing'], without: ['listening'] }).mode, 'writing');
  assert.equal(questionInMode(CARDS[0], CARDS.slice(0, 2), 'classic', seeded(), { allowed: ['classic', 'writing'] }).mode, 'writing', 'too few choices: typed instead');
});

test('which way is used: the switches, mixed at random or taking turns', () => {
  assert.deepEqual(enabledModes({ quizModeClassic: true }), ['classic']);
  assert.deepEqual(enabledModes({}), ['classic'], 'none switched on: the classic way');
  assert.deepEqual(enabledModes({ quizModeWriting: true, quizModeListening: true }), ['writing', 'listening']);
  const all = { quizModeClassic: true, quizModeWriting: true, quizModeListening: true };
  const drawn = new Set(Array.from({ length: 60 }, (_, index) => pickMode({ ...all, quizModeMixed: true }, {}, () => (index % 10) / 10)));
  assert.deepEqual([...drawn].sort(), ['classic', 'listening', 'writing'], 'mixed: all of them come up');
  assert.deepEqual([0, 1, 2, 3].map((turn) => pickMode({ ...all, quizModeMixed: false }, { modeTurn: turn })), ['classic', 'writing', 'listening', 'classic'], 'not mixed: in turn');
  assert.equal(pickMode({ quizModeWriting: true, quizModeMixed: true }, {}), 'writing');
});

// --- through the scheduler ---

let device;
beforeEach(async () => {
  device = use(createDevice('device', { uiLanguage: 'tr' }));
  for (const item of CARDS) await addEntry({ text: item.text, translation: item.translation, sourceLang: 'en', targetLang: 'tr' });
  await addEntry({ text: 'road', translation: 'yol', sourceLang: 'en', targetLang: 'tr' });
  await addEntry({ text: 'sea', translation: 'deniz', sourceLang: 'en', targetLang: 'tr' });
});

test('with only writing switched on, the quiz asks for a typed word and carries the accent setting', async () => {
  await updateSettings({ targetLang: 'tr', quizModeClassic: false, quizModeWriting: true, quizAccentTolerant: true });
  const shown = await testQuiz({ methods: ['card'] });
  assert.equal(shown.ok, true, shown.reason);
  const { question } = await readSession();
  assert.equal(question.mode, 'writing');
  assert.equal(question.accentTolerant, true);
  assert.equal((await getEntry(question.id)).text, question.answer);
});

test('a typed answer is recorded for its way of asking; a hint makes it partly right', async () => {
  const id = 'en|tr|blue';
  const plain = await recordAnswer({ id, outcome: 'answer', mode: 'writing', correct: true, hints: 0, letters: 4, ms: 9000 });
  assert.equal(plain.quality, 4);
  const hinted = await recordAnswer({ id, outcome: 'answer', mode: 'writing', correct: true, hints: 1, letters: 4, ms: 9000 });
  assert.equal(hinted.quality, 3);
  const given = await recordAnswer({ id, outcome: 'answer', mode: 'writing', correct: true, hints: 2, letters: 4, ms: 9000 });
  assert.equal(given.quality, 2, 'half the letters: asked again soon');
  const entry = await getEntry(id);
  assert.deepEqual([entry.quiz.w1, entry.quiz.n, entry.quiz.k, entry.quiz.c1], [3, 1, 3, undefined]);
  assert.deepEqual((await getQuizState()).speed, [], 'typing time is not the user\'s pace at picking');
});

test('a word that cannot be said aloud: nothing is held against it, another word takes its place, and its language is not asked by ear again', async () => {
  await updateSettings({ targetLang: 'tr', quizModeClassic: true, quizModeListening: true, quizModeMixed: false, quizQuestionsPerQuiz: 1 });
  await chrome.storage.local.set({ quizState: { modeTurn: 1 } }); // the turn of listening
  const shown = await testQuiz({ methods: ['card'] });
  assert.equal(shown.ok, true, shown.reason);
  const session = await readSession();
  assert.equal(session.question.mode, 'listening');
  assert.equal(session.question.autoplay, true);
  const before = await getEntry(session.question.id);

  const reply = await answerQuestion({ sessionId: session.id, id: session.question.id, outcome: 'no_voice', scope: 'lang', mode: 'listening' });
  assert.ok(reply.next, 'the quiz goes on, although it was to ask one question only');
  assert.equal(reply.next.index, 1, 'still the first question');
  assert.notEqual(reply.next.question.id, session.question.id);
  assert.notEqual(reply.next.question.mode, 'listening', 'English has no voice here: not asked by ear');
  const after = await getEntry(session.question.id);
  assert.deepEqual([after.quiz, after.rev], [before.quiz, before.rev + (after.dueAt !== before.dueAt ? 1 : 0)], 'no answer was recorded');
  assert.ok((await getQuizState()).noVoice.en > Date.now());
  assert.equal((await readSession()).answered, 0);
});

test('where recordings stand in for the voice, a missing one is about the word, not the language', async () => {
  await recordAnswer({ id: 'en|tr|blue', outcome: 'no_voice', scope: 'word', mode: 'listening' });
  const { noVoice } = await getQuizState();
  assert.ok(noVoice['id:en|tr|blue'] > Date.now());
  assert.equal(noVoice.en, undefined);
});

test('settings changed in quick succession all take effect', async () => {
  await Promise.all([updateSettings({ quizModeWriting: true }), updateSettings({ quizAccentTolerant: true }), updateSettings({ quizDailyGoal: 3 }), updateSettings({ quizListenChoices: 'spelling' })]);
  const { settings } = await chrome.storage.local.get('settings');
  assert.deepEqual([settings.quizModeWriting, settings.quizAccentTolerant, settings.quizDailyGoal, settings.quizListenChoices], [true, true, 3, 'spelling']);
});
