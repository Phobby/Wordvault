// A question: one saved word, four different answers, exactly one of them right.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CHOICE_COUNT, askableCards, buildQuestion, countMeanings } from '../src/quiz/question.js';
import { createRandom } from './helpers/random.js';

const card = (text, translation, fields = {}) => ({ id: `en|tr|${text.toLowerCase()}`, text, translation, sourceLang: 'en', targetLang: 'tr', alternatives: [], ...fields });
const VAULT = [card('book', 'kitap'), card('door', 'kapı'), card('tree', 'ağaç'), card('water', 'su'), card('house', 'ev'), card('light', 'ışık', { alternatives: ['hafif', 'açık'] }), card('bright', 'açık')];

test('every question has four different choices and exactly one right answer', () => {
  const random = createRandom(42);
  for (let round = 0; round < 500; round++) {
    const built = buildQuestion(VAULT, 'tr', random.next);
    assert.ok(built.ok);
    const { question } = built;
    const asked = VAULT.find((entry) => entry.id === question.id);
    assert.equal(question.choices.length, CHOICE_COUNT);
    assert.equal(new Set(question.choices.map((choice) => choice.toLowerCase())).size, CHOICE_COUNT, 'no repeated choice');
    assert.equal(question.choices[question.answer], asked.translation);
    assert.equal(question.choices.filter((choice) => choice === asked.translation).length, 1, 'the right answer appears once');
    assert.equal(question.word, asked.text);
    for (const other of asked.alternatives) assert.ok(!question.choices.includes(other), 'another meaning of the same word is never offered as a wrong answer');
  }
});

test('the order of the choices and the word asked vary', () => {
  const random = createRandom(7);
  const positions = new Set();
  const words = new Set();
  for (let round = 0; round < 200; round++) {
    const { question } = buildQuestion(VAULT, 'tr', random.next);
    positions.add(question.answer);
    words.add(question.id);
  }
  assert.equal(positions.size, CHOICE_COUNT, 'the right answer turns up in every position');
  assert.equal(words.size, VAULT.length, 'every word gets asked');
});

test('only words with a translation into the target language count', () => {
  const vault = [...VAULT, card('untranslated', ''), card('Haus', 'house', { id: 'de|en|haus', sourceLang: 'de', targetLang: 'en' })];
  assert.equal(askableCards(vault, 'tr').length, VAULT.length);
  assert.equal(askableCards(vault, 'tr-TR').length, VAULT.length, 'regional variants are the same language');
  assert.equal(askableCards(vault, 'en').length, 1);
  assert.equal(countMeanings(askableCards(vault, 'tr')), 7);
  assert.equal(countMeanings(askableCards([...vault, card('open', 'Açık ')], 'tr')), 7, 'the same meaning saved twice is one');
});

test('too few different meanings: no question, and no error either', () => {
  assert.deepEqual(buildQuestion([], 'tr'), { ok: false, reason: 'no_cards' });
  assert.deepEqual(buildQuestion([card('untranslated', '')], 'tr'), { ok: false, reason: 'no_cards' });
  assert.deepEqual(buildQuestion(VAULT.slice(0, 3), 'tr'), { ok: false, reason: 'not_enough_choices' });
  // Four words but only three meanings.
  assert.deepEqual(buildQuestion([card('a', 'bir'), card('one', 'bir'), card('two', 'iki'), card('three', 'üç')], 'tr'), { ok: false, reason: 'not_enough_choices' });
  assert.equal(buildQuestion(VAULT.slice(0, 4), 'tr').ok, true);
  assert.deepEqual(buildQuestion(VAULT, 'de'), { ok: false, reason: 'no_cards' });
});

test('the same word saved in two language pairs does not give the answer away', () => {
  const vault = [card('gift', 'hediye'), card('gift', 'zehir', { id: 'de|tr|gift', sourceLang: 'de' }), card('door', 'kapı'), card('tree', 'ağaç'), card('water', 'su')];
  const random = createRandom(3);
  for (let round = 0; round < 200; round++) {
    const { question } = buildQuestion(vault, 'tr', random.next);
    if (question.word !== 'gift') continue;
    assert.ok(!(question.choices.includes('hediye') && question.choices.includes('zehir')));
  }
});
