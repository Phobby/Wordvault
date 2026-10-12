// No character is lost on the way: from the translation service's answer through the provider,
// the vault, the backup file and the synchronised document. And when the service itself sends
// a word with letters missing ("e?itle" for "eşitle"), that is noticed and asked for again.

import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import { createBackup, restoreBackup } from '../src/lib/backup.js';
import { looksDamaged } from '../src/lib/text-damage.js';
import { translate } from '../src/lib/translator.js';
import { addEntry, listEntries } from '../src/lib/vault.js';
import { decodeDocument, encodeDocument } from '../src/sync/codec.js';
import { readLocalDocument } from '../src/sync/local.js';
import { createDevice, use } from './helpers/chrome.js';

/** Words with the letters that break first, per language. */
const SAMPLES = {
  tr: ['eşitle', 'ağaç', 'ışık', 'İstanbul', 'çöğür', 'Şükrü Ğ ğ ı İ ö ü ç', 'IĞDIR'],
  de: ['Straße', 'Äpfel', 'übergrößenträger'],
  fr: ['garçon', 'élève', 'Noël', 'cœur', 'où ça ?'],
  es: ['¿qué tal?', 'mañana', 'pingüino'],
  ru: ['синхронизировать', 'ёлка', 'Щука'],
  ar: ['مزامنة', 'مَرْحَبًا'],
  ja: ['同期する', 'カタカナ', 'ひらがな'],
  'zh-CN': ['同步', '你好吗？'],
  ko: ['동기화'],
  el: ['συγχρονισμός'],
  he: ['סנכרון'],
  hi: ['समकालीन'],
  th: ['ซิงค์'],
  vi: ['đồng bộ hóa'],
  emoji: ['ok 👍🏽', '𝒔𝒚𝒏𝒄'],
};
const ALL = Object.values(SAMPLES).flat();

let device;
let answers; // what the stand-in service says, by "pair q"
let asked;
const realFetch = globalThis.fetch;

/** The service's reply as the bytes of an HTTP body, read the way fetch reads them. */
function reply(body, { escaped = false } = {}) {
  let json = JSON.stringify(body);
  // MyMemory writes non-ASCII as \uXXXX; other services send the UTF-8 bytes. Both must survive.
  if (escaped) json = json.replace(/[\u0080-￿]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
  return new Response(new TextEncoder().encode(json), { status: 200, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  device = use(createDevice('device', { uiLanguage: 'tr', detect: () => null }));
  answers = new Map();
  asked = [];
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    const pair = url.searchParams.get('langpair');
    const q = url.searchParams.get('q');
    asked.push(`${pair} ${q}`);
    const answer = answers.get(`${pair} ${q}`) ?? answers.get(`* ${q}`) ?? answers.get('*');
    const translated = typeof answer === 'function' ? answer(q, pair) : answer;
    const data = { translatedText: translated ?? q };
    if (pair.startsWith('Autodetect')) data.detectedLanguage = 'en';
    return reply({ responseData: data, responseStatus: 200, responseDetails: '', matches: [] }, { escaped: asked.length % 2 === 0 });
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

test('every letter of a translation arrives: Turkish, and a dozen other scripts', async () => {
  for (const [language, words] of Object.entries(SAMPLES)) {
    for (const word of words) {
      answers.set('*', word);
      const result = await translate({ text: 'sample', source: 'en' }, 'example.com');
      assert.equal(result.translation, word, `${language}: ${word}`);
      assert.equal(result.damaged, false, `${language}: ${word} is not taken for damaged text`);
      // the same code points, not something that only looks alike
      assert.deepEqual([...result.translation].map((ch) => ch.codePointAt(0)), [...word].map((ch) => ch.codePointAt(0)));
    }
  }
});

test('letters written as HTML entities by the service are turned back into the letters', async () => {
  answers.set('*', 'e&#351;itle, a&#x11F;a&ccedil; &amp; &#x131;&#x15F;&#305;k');
  const result = await translate({ text: 'sample', source: 'en' }, 'example.com');
  assert.equal(result.translation, 'eşitle, ağa&ccedil; & ışık', 'numeric entities are decoded; unknown named ones are left as they came');
});

test('text sent for translation is not altered either', async () => {
  answers.set('*', 'ok');
  for (const word of ['eşitle', 'ığdır', 'Straße', '同期', 'مزامنة']) {
    await translate({ text: word, source: 'en' }, 'example.com');
    assert.ok(asked.some((entry) => entry.endsWith(` ${word}`)), word);
  }
});

test('"sync": the service loses the ş in one answer; the other answer is used', async () => {
  // as observed on 2026-10-12: machine translation "e? itle", translation memory "eşitleme, eşitleme"
  answers.set('Autodetect|tr sync', 'e? itle');
  answers.set('en|tr sync', 'eşitleme, eşitleme');
  const result = await translate({ text: 'sync', source: 'en' }, 'example.com');
  assert.equal(result.translation, 'eşitleme');
  assert.equal(result.damaged, false);
  assert.ok(!JSON.stringify(result).includes('?'), 'the damaged answer is not shown anywhere, not even as an alternative');
});

test('both answers damaged: asked once more with the first letter in the other case', async () => {
  answers.set('Autodetect|tr sync', 'e? itle');
  answers.set('en|tr sync', 'e?itleme');
  answers.set('Autodetect|tr Sync', 'Eşitle');
  const result = await translate({ text: 'sync', source: 'en' }, 'example.com');
  assert.equal(result.translation, 'eşitle', 'with the first letter as the user wrote it');
  assert.equal(result.damaged, false);
});

test('source language unknown: a damaged answer is repaired the same way', async () => {
  answers.set('Autodetect|tr sync', 'e? itle');
  answers.set('en|tr sync', 'eşitleme');
  const result = await translate({ text: 'sync' }, 'example.com');
  assert.equal(result.translation, 'eşitleme');
  assert.equal(result.damaged, false);
});

test('nothing clean to be had: the answer is shown, marked as damaged, and can still be saved', async () => {
  answers.set('*', 'e?itle');
  const result = await translate({ text: 'sync', source: 'en' }, 'example.com');
  assert.equal(result.translation, 'e?itle');
  assert.equal(result.damaged, true);
});

test('damaged text is told from text that merely has a question mark', () => {
  for (const text of ['e?itle', 'e? itle', 'a?aç', 'g�naydın', 'eÅŸitle', 'gÃ¼naydÄ±n', 'Stra?e']) assert.equal(looksDamaged(text, 'sync'), true, text);
  for (const text of [...ALL, 'Nasılsın?', 'Ne? Evet.', 'Gerçekten mi? Evet', '¿qué tal?', 'hazır mısın?', 'A ? B', '?', '']) {
    assert.equal(looksDamaged(text, 'sample'), false, text);
  }
  assert.equal(looksDamaged('ne? evet', 'what? yes'), false, 'a question in the source explains the question mark');
  assert.equal(looksDamaged('ne? evet', 'sync'), true);
});

test('the vault, the backup file and the synchronised document keep every character', async () => {
  for (const [index, word] of ALL.entries()) {
    await addEntry({ text: `word${index}`, translation: word, alternatives: [word.toUpperCase()], sourceLang: 'en', targetLang: 'tr', sentence: `«${word}» — ${word}`, title: word });
  }
  const stored = await listEntries();
  assert.deepEqual(stored.map((entry) => entry.translation).sort(), [...ALL].sort());
  assert.ok(stored.every((entry) => entry.sentence === `«${entry.translation}» — ${entry.translation}`));

  // export, then import on another device
  const file = JSON.stringify(await createBackup());
  for (const word of ALL) assert.ok(file.includes(JSON.stringify(word).slice(1, -1)), `the file holds ${word}`);
  const bytes = new TextEncoder().encode(file); // what is written to disk
  use(createDevice('other', { uiLanguage: 'en' }));
  const restored = await restoreBackup(new TextDecoder().decode(bytes));
  assert.equal(restored.added, ALL.length);
  assert.deepEqual((await listEntries()).map((entry) => entry.translation).sort(), [...ALL].sort());

  // the synchronised document: compressed, written, read back
  use(device);
  const document = await readLocalDocument();
  assert.deepEqual(await decodeDocument(await encodeDocument(document)), document);
  const translations = Object.values(document.e).map((record) => JSON.stringify(record));
  for (const word of ALL) assert.ok(translations.some((record) => record.includes(JSON.stringify(word).slice(1, -1))), `the document holds ${word}`);
});
