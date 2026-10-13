// A selected sentence or paragraph: cutting it into pieces a service takes, putting the
// answers together, the upper limit, and what is remembered.

import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import { PASSAGE_MAX_CHARS, joinPassage, splitPassage, tidyPassage } from '../src/lib/passage.js';
import { updateSettings } from '../src/lib/settings.js';
import { cacheKey } from '../src/lib/translation-cache.js';
import { translatePassage } from '../src/lib/translator.js';
import { createDevice, use } from './helpers/chrome.js';

const bytes = (text) => new TextEncoder().encode(text).length;
const ENGLISH = 'The quick brown fox jumps over the lazy dog. It does so every morning! Does the dog mind? Nobody has ever asked the dog.';
const TURKISH = 'Hızlı kahverengi tilki tembel köpeğin üzerinden atlar. Bunu her sabah yapar! Köpek buna aldırır mı? Kimse köpeğe sormadı.';
const ARABIC = 'القط يجلس على السجادة. الكلب ينام في الحديقة! هل تحب القراءة؟ أنا أقرأ كل يوم في المساء.';
const JAPANESE = '私は学生です。東京に住んでいます。毎日電車で学校に行きます。週末は友達と映画を見ます。';

/** Sentences that are all different, so that no piece is the same as another. */
const story = (count) => Array.from({ length: count }, (_, index) => `Sentence number ${index + 1} tells what happened on day ${index + 1} of the long journey.`).join(' ');

let service;
const realFetch = globalThis.fetch;

beforeEach(async () => {
  use(createDevice('device', { uiLanguage: 'en-US' }));
  service = { calls: [], failAt: 0 };
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    const text = url.searchParams.get('q');
    service.calls.push({ text, pair: url.searchParams.get('langpair') });
    if (service.failAt && service.calls.length >= service.failAt) throw new TypeError('Failed to fetch');
    return { status: 200, json: async () => ({ responseData: { translatedText: `<${text}>`, detectedLanguage: 'en' }, responseStatus: 200, responseDetails: '', matches: [] }) };
  };
  await updateSettings({ targetLang: 'tr' });
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

test('tidying keeps paragraphs and nothing else of the white space', () => {
  assert.equal(tidyPassage('  One  two.\r\n\r\n\r\n\r\nThree\tfour. \n Five.  '), 'One two.\n\nThree four.\nFive.');
  assert.equal(tidyPassage(null), '');
});

for (const [name, text] of [['English', ENGLISH], ['Turkish', TURKISH], ['Arabic', ARABIC], ['Japanese', JAPANESE]]) {
  test(`${name}: pieces stay under the limit, end where sentences end, and nothing is lost`, () => {
    const limit = 80;
    const pieces = splitPassage(text, { maxBytes: limit });
    assert.ok(pieces.length > 1, 'more than one piece');
    for (const piece of pieces) {
      assert.ok(bytes(piece.text) <= limit, `${bytes(piece.text)} bytes`);
      assert.match(piece.text, /[.!?。？！؟]$/u, 'ends with the end of a sentence');
    }
    // the source put together again is the source
    assert.equal(pieces.map((piece) => piece.text + piece.glue).join(''), text);
  });
}

test('a text that fits is one piece', () => {
  assert.deepEqual(splitPassage(ENGLISH, { maxBytes: 500 }), [{ text: ENGLISH, glue: '' }]);
  assert.deepEqual(splitPassage('', { maxBytes: 500 }), []);
});

test('a sentence longer than a piece is cut between words, a longer word between letters', () => {
  const pieces = splitPassage('an extraordinarily long sentence without any stop that goes on and on and on', { maxChars: 30 });
  assert.ok(pieces.length > 1);
  for (const piece of pieces) assert.ok(piece.text.length <= 30);
  assert.equal(pieces.map((piece) => piece.text + piece.glue).join(''), 'an extraordinarily long sentence without any stop that goes on and on and on');
  assert.deepEqual(splitPassage('abcdefghij', { maxChars: 4 }).map((piece) => piece.text), ['abcd', 'efgh', 'ij']);
});

test('paragraphs: kept apart for a service that loses line breaks, together for one that keeps them', () => {
  const text = 'First one. Still the first.\n\nSecond one.\nThird.';
  const apart = splitPassage(text, { maxBytes: 500 });
  assert.deepEqual(apart, [{ text: 'First one. Still the first.', glue: '\n\n' }, { text: 'Second one.', glue: '\n' }, { text: 'Third.', glue: '' }]);
  assert.deepEqual(splitPassage(text, { maxChars: 500, acrossParagraphs: true }), [{ text, glue: '' }]);
  assert.equal(joinPassage(['A.', 'B.', 'C.'], apart, 'tr'), 'A.\n\nB.\nC.');
});

test('joining: a space between sentences, none where the language is written without', () => {
  const pieces = splitPassage(JAPANESE, { maxBytes: 80 });
  const parts = pieces.map((_, index) => `S${index}.`);
  assert.equal(joinPassage(parts, pieces, 'en'), parts.join(' '));
  assert.equal(joinPassage(parts, pieces, 'ja'), parts.join(''));
  // fewer answers than pieces (one failed): what there is, without a loose end
  assert.equal(joinPassage(parts.slice(0, 2), pieces, 'en'), 'S0. S1.');
});

test('more than the upper limit is refused before anything is sent', async () => {
  const long = 'word '.repeat(PASSAGE_MAX_CHARS / 5 + 1).trim();
  await assert.rejects(translatePassage({ text: long }, 'example.com'), (error) => error.code === 'passage_too_long' && error.detail === String(PASSAGE_MAX_CHARS) && error.context.length === long.length);
  assert.equal(service.calls.length, 0);
  const justFits = 'word '.repeat(PASSAGE_MAX_CHARS / 5).trim();
  assert.equal((await translatePassage({ text: justFits, source: 'en' }, 'example.com')).partial, null);
});

test('a long text goes to the service in pieces, in order, and comes back as one', async () => {
  const text = `${story(20)}\n\n${ENGLISH}`;
  const seen = [];
  const result = await translatePassage({ text, source: 'en' }, 'example.com', (progress) => seen.push(progress));
  assert.ok(service.calls.length > 2);
  for (const call of service.calls) {
    assert.ok(bytes(call.text) <= 500);
    assert.equal(call.pair, 'en|tr');
  }
  assert.equal(result.pieces, service.calls.length);
  assert.equal(result.translation.replace(/[<>]/g, ''), text);
  assert.equal(result.passage, true);
  assert.equal(result.partial, null);
  assert.equal(result.provider.id, 'mymemory');
  assert.deepEqual(seen.map((progress) => progress.done), service.calls.slice(1).map((_, index) => index + 1));
  assert.equal(seen[0].total, service.calls.length);
});

test('every piece is remembered: the same text again asks for nothing', async () => {
  const text = story(20);
  const first = await translatePassage({ text, source: 'en' }, 'example.com');
  const asked = service.calls.length;
  const second = await translatePassage({ text, source: 'en' }, 'example.com');
  assert.equal(service.calls.length, asked);
  assert.equal(second.translation, first.translation);
});

test('the cache key holds the text, the language pair and the service', () => {
  const base = { provider: 'mymemory', source: 'en', target: 'tr', text: ENGLISH };
  const key = cacheKey(base);
  assert.equal(cacheKey({ ...base, text: `  ${ENGLISH} ` }), key);
  for (const other of [{ provider: 'deepl' }, { source: 'de' }, { target: 'fr' }, { text: `${ENGLISH} More.` }]) assert.notEqual(cacheKey({ ...base, ...other }), key);
});

test('a piece that fails after others worked: what there is, and what went wrong', async () => {
  const text = story(30);
  service.failAt = 3;
  const result = await translatePassage({ text, source: 'en' }, 'example.com');
  assert.equal(result.partial.code, 'network');
  assert.equal(result.partial.done, 2);
  assert.ok(result.pieces > 2);
  assert.ok(result.translation.startsWith('<Sentence number 1 '));
  assert.ok(result.translation.length < text.length);
  // "try again" asks only for what is missing
  service.failAt = 0;
  const before = service.calls.length;
  const again = await translatePassage({ text, source: 'en', fresh: true }, 'example.com');
  assert.equal(again.partial, null);
  assert.equal(service.calls.length - before, result.pieces - 2);
});

test('the first piece failing is an error, with nothing to show', async () => {
  service.failAt = 1;
  await assert.rejects(translatePassage({ text: ENGLISH, source: 'en' }, 'example.com'), (error) => error.code === 'network' && error.context.targetLang === 'tr');
});

test('text in the language translations are made into: a note, not an error', async () => {
  globalThis.fetch = async () => ({ status: 200, json: async () => ({ responseData: { translatedText: '' }, responseStatus: '403', responseDetails: 'PLEASE SELECT TWO DISTINCT LANGUAGES' }) });
  const picked = await translatePassage({ text: TURKISH, source: 'tr' }, 'example.com');
  assert.equal(picked.sameLanguage, true);
  const automatic = await translatePassage({ text: TURKISH, pageLang: 'tr' }, 'example.com');
  assert.equal(automatic.sameLanguage, true);
  assert.equal(automatic.sourceLang, 'tr');
});

// --- one word, or more? ---------------------------------------------------------------------

test('one word is looked up as a word, more than one is a passage', async () => {
  const { loadScripts } = await import('./helpers/hover.js');
  const { passageText } = loadScripts(['shared/passage-text.js']);
  for (const word of ['serendipity', ' book ', 'ice-cream', "don't", '3.5', 'e-mail,', '«kitap»', 'İstanbul', 'كتاب', '学生', '']) {
    assert.equal(passageText.isPassage(word), false, `"${word}" is one word (or none)`);
  }
  for (const passage of ['New York', 'the quick brown fox', 'Bugün hava güzel.', 'الطقس جميل اليوم', '私は学生です', 'line one\nline two', 'a – b']) {
    assert.equal(passageText.isPassage(passage), true, `"${passage}" is a passage`);
  }
  assert.equal(passageText.wordCount('  one   two\tthree  '), 3);
  assert.equal(passageText.wordCount('… — !'), 0);
});
