// Which language pair is sent to the translation service, and when detection runs.
// The service is replaced by a stand-in that behaves like MyMemory; nothing goes on the network.

import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import { getPreferences, setSiteSourceLanguage, setTargetLanguage, translate } from '../src/lib/translator.js';
import { createDevice, use } from './helpers/chrome.js';

const ENGLISH = 'Many important discoveries happened by serendipity rather than by careful planning.';
const TURKISH = 'Kelebek etkisi küçük değişikliklerin büyük sonuçlar doğurabileceğini anlatır.';

let device;
let requests; // language pairs the stand-in service was asked for
let service; // how the stand-in behaves
const realFetch = globalThis.fetch;

beforeEach(() => {
  device = use(createDevice('device', { uiLanguage: 'en-US', detect: (text) => (text.startsWith('Kelebek') || text.startsWith('İngilizcede') ? 'tr' : text.length > 20 ? 'en' : null) }));
  requests = [];
  service = { detects: 'en', fails: null, reportsDetection: true };
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    const pair = url.searchParams.get('langpair');
    requests.push({ host: url.host, text: url.searchParams.get('q'), pair, query: url.search });
    if (service.fails === 'network') throw new TypeError('Failed to fetch');
    const reply = (body) => ({ status: 200, json: async () => body });
    if (service.fails === 'quota') return reply({ responseData: { translatedText: 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY' }, quotaFinished: true, responseStatus: 429 });
    const [source, target] = pair.split('|');
    const from = source === 'Autodetect' ? service.detects : source;
    if (from === target) return reply({ responseData: { translatedText: 'PLEASE SELECT TWO DISTINCT LANGUAGES' }, responseStatus: '403', responseDetails: 'PLEASE SELECT TWO DISTINCT LANGUAGES', matches: '' });
    const data = { translatedText: `${url.searchParams.get('q')}@${from}>${target}${source === 'Autodetect' ? '/machine' : '/memory'}` };
    if (source === 'Autodetect' && service.reportsDetection) data.detectedLanguage = from;
    return reply({ responseData: data, responseStatus: 200, responseDetails: '', matches: [] });
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
});
const pairs = () => requests.map((request) => request.pair).sort();

test('until the user chooses, the target is the browser language, and that is reported as "not chosen"', async () => {
  const prefs = await getPreferences('example.com');
  assert.equal(prefs.targetLang, 'en');
  assert.equal(prefs.targetChosen, false);
  assert.ok(prefs.languages.length > 100);
});

test('text already in the target language is a note on the result, not an error', async () => {
  const result = await translate({ text: 'serendipity', sample: ENGLISH, pageLang: 'en' }, 'example.com');
  assert.equal(result.sameLanguage, true);
  assert.equal(result.translation, '');
  assert.deepEqual([result.sourceLang, result.targetLang], ['en', 'en']);
  assert.deepEqual(pairs(), ['Autodetect|en'], 'the translation was still attempted');
});

test('the chosen target is stored once and used for the pair sent to the service', async () => {
  assert.equal(await setTargetLanguage('tr'), 'tr');
  assert.equal(device.dump().settings.targetLang, 'tr');
  assert.deepEqual([(await getPreferences()).targetLang, (await getPreferences()).targetChosen], ['tr', true]);

  const result = await translate({ text: 'serendipity', sample: ENGLISH, pageLang: 'en' }, 'example.com');
  assert.deepEqual(pairs(), ['Autodetect|tr', 'en|tr']);
  assert.deepEqual([result.sourceLang, result.targetLang, result.sourceMode, result.sameLanguage], ['en', 'tr', 'auto', false]);
  assert.equal(result.translation, 'serendipity@en>tr/machine');
  for (const request of requests) {
    assert.equal(request.host, 'api.mymemory.translated.net');
    assert.equal(request.text, 'serendipity');
    assert.match(request.query, /langpair=(en|Autodetect)%7Ctr/, 'source|target, URL-encoded');
    assert.ok(!request.query.includes('discoveries'), 'the surrounding text is never sent');
  }
});

test('longer text is translated with a single request for the exact pair', async () => {
  await setTargetLanguage('tr');
  await translate({ text: 'the quick brown fox jumps over the lazy dog every single morning', sample: ENGLISH, pageLang: 'en' }, 'example.com');
  assert.deepEqual(pairs(), ['en|tr']);
});

test('a source language picked by the user is used as is: the detector does not run', async () => {
  await setTargetLanguage('tr');
  service.detects = 'pt'; // the service would guess wrong
  const result = await translate({ text: 'gift', sample: ENGLISH, pageLang: 'en', source: 'de' }, 'example.com');
  assert.deepEqual(device.detected, []);
  assert.deepEqual([result.sourceLang, result.sourceMode], ['de', 'manual']);
  assert.equal(result.translation, 'gift@de>tr/memory', 'the answer for de|tr, not the service\'s own guess');
  assert.ok(pairs().includes('de|tr'));
});

test('picking the target language as source asks nothing of the service', async () => {
  await setTargetLanguage('tr');
  const result = await translate({ text: 'kelebek', source: 'tr' }, 'example.com');
  assert.equal(result.sameLanguage, true);
  assert.deepEqual([requests.length, device.detected.length], [0, 0]);
});

test('a source language pinned to a site is used there, and only there', async () => {
  await setTargetLanguage('tr');
  assert.equal(await setSiteSourceLanguage('example.com', 'de'), 'de');
  let result = await translate({ text: 'Schmetterling', sample: ENGLISH, pageLang: 'en' }, 'example.com');
  assert.deepEqual([result.sourceLang, result.sourceMode, device.detected.length], ['de', 'site', 0]);
  assert.equal((await getPreferences('example.com')).siteSource, 'de');

  result = await translate({ text: 'serendipity', sample: ENGLISH, pageLang: 'en' }, 'other.org');
  assert.deepEqual([result.sourceLang, result.sourceMode], ['en', 'auto']);

  await setSiteSourceLanguage('example.com', null);
  assert.equal((await getPreferences('example.com')).siteSource, '');
});

test('a foreign word quoted in target-language text is still translated', async () => {
  await setTargetLanguage('tr');
  const result = await translate({ text: 'butterfly', sample: 'İngilizcede butterfly kelimesi kelebek anlamına gelir ve çok kullanılır.', pageLang: 'tr' }, 'example.com');
  assert.deepEqual(pairs(), ['Autodetect|tr']);
  assert.deepEqual([result.sourceLang, result.sameLanguage], ['en', false]);
});

test('when the service finds the text to be in the target language, that is a note', async () => {
  await setTargetLanguage('tr');
  service.detects = 'tr';
  const result = await translate({ text: 'kelebek', sample: TURKISH, pageLang: 'tr' }, 'example.com');
  assert.deepEqual([result.sameLanguage, result.translation, result.sourceLang], [true, '', 'tr']);
});

test('if the service does not say what it detected, the text itself is put to the detector', async () => {
  await setTargetLanguage('tr');
  service.reportsDetection = false;
  device = use(createDevice('device', { detect: () => 'fr' }));
  await setTargetLanguage('tr');
  const result = await translate({ text: 'bonjour' }, 'example.com');
  assert.deepEqual(pairs(), ['Autodetect|tr']);
  assert.equal(result.sourceLang, 'fr');
  assert.equal(device.detected.at(-1), 'bonjour');
});

test('a failed request reports its kind and what was known, so the word can still be saved', async () => {
  await setTargetLanguage('tr');
  service.fails = 'network';
  await assert.rejects(translate({ text: 'serendipity', sample: ENGLISH, pageLang: 'en' }, 'example.com'), (error) => error.code === 'network' && error.context.text === 'serendipity' && error.context.sourceLang === 'en' && error.context.targetLang === 'tr');
  service.fails = 'quota';
  await assert.rejects(translate({ text: 'serendipity', sample: ENGLISH, pageLang: 'en' }, 'example.com'), (error) => error.code === 'rate_limit');
});

test('a target language is checked against what the service offers', async () => {
  await assert.rejects(setTargetLanguage('xx'), (error) => error.code === 'unsupported_language');
  assert.equal(await setTargetLanguage('zh'), 'zh-CN');
  assert.equal(await setTargetLanguage('tr-TR'), 'tr');
});
