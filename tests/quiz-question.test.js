// A question: one saved word, four different answers, exactly one of them right.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CHOICE_COUNT, askableCards, buildQuestion, countMeanings, questionFor, tooSimilar } from '../src/quiz/question.js';
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

test('answers that are the same or nearly the same are recognised', () => {
  for (const [a, b] of [['kitap', 'Kitap '], ['kitap', 'kitaplar'], ['kitap', 'kitab'], ['kitap', 'kitabı'], ['ışık', 'ışığı'], ['açık', 'acik'], ['rezervasyon', 'rezervasyon yapın'], ['to run', 'run'], ['understanding', 'understandings'], ['', 'x']]) {
    assert.equal(tooSimilar(a, b), true, `${a} / ${b}`);
    assert.equal(tooSimilar(b, a), true, `${b} / ${a}`);
  }
  for (const [a, b] of [['kitap', 'kapı'], ['ev', 'evet'], ['su', 'süt'], ['ağaç', 'açık'], ['masa', 'kasa yok'], ['yol', 'yıldız'], ['deniz', 'dünya'], ['understand', 'underwear']]) {
    assert.equal(tooSimilar(a, b), false, `${a} / ${b}`);
  }
});

test('choices too close to the right answer, to its other meanings or to each other are never offered', () => {
  const asked = card('light', 'ışık', { alternatives: ['hafif', 'açık'] });
  const vault = [
    asked,
    card('lights', 'ışıklar'), // another form of the answer
    card('lamp', 'Işık'), // the answer itself, saved for another word
    card('easy', 'hafif'), // another meaning of the asked word
    card('bright', 'açık renk'), // contains another meaning
    card('book', 'kitap'),
    card('books', 'kitaplar'), // too close to "kitap": only one of the two may appear
    card('door', 'kapı'),
    card('tree', 'ağaç'),
    card('water', 'su'),
  ];
  const random = createRandom(21);
  for (let round = 0; round < 500; round++) {
    const question = questionFor(asked, vault, random.next);
    assert.equal(question.choices.length, CHOICE_COUNT);
    assert.equal(question.choices[question.answer], 'ışık');
    const wrong = question.choices.filter((_, index) => index !== question.answer);
    for (const choice of wrong) {
      for (const taken of ['ışık', 'hafif', 'açık']) assert.equal(tooSimilar(choice, taken), false, `${choice} is too close to ${taken}`);
    }
    assert.ok(!(wrong.includes('kitap') && wrong.includes('kitaplar')), 'two forms of one word are not both offered');
    assert.equal(question.chars, question.choices.join('').length);
  }
});

test('a word with too few usable wrong answers gets no question; the vault may still have others', () => {
  const vault = [card('light', 'ışık'), card('lights', 'ışıklar'), card('lamp', 'ışığı'), card('door', 'kapı'), card('tree', 'ağaç')];
  assert.equal(questionFor(vault[0], vault), null, 'only two usable wrong answers for "ışık"');
  // The builder passes such a word over and asks one that does work, if there is any.
  const random = createRandom(8);
  for (let round = 0; round < 200; round++) {
    const built = buildQuestion(vault, 'tr', random.next);
    assert.equal(built.ok, true);
    assert.notEqual(built.question.word, 'light');
  }
  // Four different translations, but two are forms of one word: no fair question exists.
  const tight = [card('light', 'ışık'), card('lights', 'ışıklar'), card('door', 'kapı'), card('tree', 'ağaç')];
  assert.equal(countMeanings(tight), 4);
  assert.deepEqual(buildQuestion(tight, 'tr'), { ok: false, reason: 'not_enough_choices' });
});

test('wrong answers resemble the right one: same kind of word, similar length', () => {
  const noun = { groups: [{ partOfSpeech: 'Noun', definitions: [] }] };
  const verb = { groups: [{ partOfSpeech: 'Verb', definitions: [] }] };
  const asked = card('house', 'ev', { dictionary: noun });
  const nouns = ['su', 'at', 'göz', 'yol', 'taş', 'kuş', 'dağ', 'gül'].map((t, i) => card(`noun${i}`, t, { dictionary: noun }));
  const verbs = ['koşmak', 'yürümek', 'düşünmek', 'anlamak', 'beklemek', 'çalışmak', 'öğrenmek', 'konuşmak'].map((t, i) => card(`verb${i}`, t, { dictionary: verb }));
  const phrases = ['bir şeyin üzerinde durmak', 'uzun bir yolculuğa çıkmak', 'hiçbir şey anlamamak'].map((t, i) => card(`phrase${i}`, t));
  const vault = [asked, ...nouns, ...verbs, ...phrases];
  const random = createRandom(13);
  const seen = new Set();
  let nounChoices = 0;
  let total = 0;
  for (let round = 0; round < 400; round++) {
    const question = questionFor(asked, vault, random.next);
    for (const [index, choice] of question.choices.entries()) {
      if (index === question.answer) continue;
      seen.add(choice);
      total += 1;
      if (nouns.some((n) => n.translation === choice)) nounChoices += 1;
      assert.ok(!phrases.some((p) => p.translation === choice), 'a long phrase is never offered next to a two-letter answer');
    }
  }
  assert.equal(nounChoices, total, 'with enough nouns of similar length, every wrong answer is one');
  assert.ok(seen.size >= 5, `the wrong answers vary between questions (${seen.size} different ones)`);
});
