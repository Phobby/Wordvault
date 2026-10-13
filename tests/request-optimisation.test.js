// Asking less: one spelling per text in the cache keys (with Turkish İ/ı), one request for
// many askers, giving a request up when the user moves on (without spoiling the cache), and a
// short memory of failures that asking again would not change.

import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import { normalizeText } from '../src/lib/cache-key.js';
import { updateSettings } from '../src/lib/settings.js';
import { FAILURE_MS } from '../src/lib/session-cache.js';
import { CACHE_KEY, cacheKey } from '../src/lib/translation-cache.js';
import { cancelTranslation, translate } from '../src/lib/translator.js';
import { addEntry, listEntries } from '../src/lib/vault.js';
import { createDevice, use } from './helpers/chrome.js';
import { loadScripts } from './helpers/hover.js';

let device;
let service; // the stand-in translation service
const realFetch = globalThis.fetch;
const realNow = Date.now;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(async () => {
  device = use(createDevice('device', { uiLanguage: 'en-US' }));
  service = { calls: [], aborted: 0, hold: null, fail: null };
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input);
    const text = url.searchParams.get('q');
    service.calls.push(text);
    if (service.hold) {
      // the answer is on its way until the test lets it through, or the request is given up
      await new Promise((resolve, reject) => {
        service.hold.push(resolve);
        init.signal?.addEventListener('abort', () => {
          service.aborted += 1;
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
      });
    }
    if (service.fail === 'network') throw new TypeError('Failed to fetch');
    const reply = (body) => ({ status: 200, json: async () => body });
    if (service.fail === 'quota') return reply({ responseData: { translatedText: 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY' }, quotaFinished: true, responseStatus: 429 });
    if (service.fail === 'empty') return reply({ responseData: { translatedText: '' }, responseStatus: 200, responseDetails: '', matches: [] });
    return reply({ responseData: { translatedText: `<${text}>`, detectedLanguage: 'en' }, responseStatus: 200, responseDetails: '', matches: [] });
  };
  await updateSettings({ targetLang: 'tr' });
});
afterEach(() => {
  globalThis.fetch = realFetch;
  Date.now = realNow;
});

/** A long text: MyMemory is then asked once per lookup, which makes requests countable. */
const LONG = 'this sentence is long enough to be asked for with a single request';
const ask = (text, more = {}) => translate({ text, source: 'en', ...more }, 'example.com');
const entries = async () => Object.keys((await chrome.storage.local.get(CACHE_KEY))[CACHE_KEY]?.entries || {});
const release = () => {
  const waiting = service.hold;
  service.hold = null;
  waiting.forEach((resolve) => resolve());
};

// --- one spelling ---

test('the key spelling: case, spaces, punctuation around the text, Unicode form', () => {
  assert.equal(normalizeText('  Book  '), 'book');
  assert.equal(normalizeText('“Book,”'), 'book');
  assert.equal(normalizeText('(serendipity)!'), 'serendipity');
  assert.equal(normalizeText('a   good\n book'), 'a good book');
  assert.equal(normalizeText("don't"), "don't", 'punctuation inside stays');
  assert.equal(normalizeText('e-mail.'), 'e-mail');
  assert.equal(normalizeText('...'), '...', 'text that is only punctuation is left as it is');
  assert.equal(normalizeText('café'), 'café', 'composed and decomposed letters are the same text');
  assert.equal(normalizeText('ÉCOLE', 'fr'), 'école');
  assert.equal(normalizeText('STRASSE', 'de'), 'strasse');
  assert.equal(normalizeText('Ελληνικά'), 'ελληνικά');
  assert.equal(normalizeText(null), '');
});

test('Turkish İ/ı: capital I is ı and capital İ is i, only where the language says so', () => {
  assert.equal(normalizeText('IŞIK', 'tr'), 'ışık');
  assert.equal(normalizeText('İSTANBUL', 'tr'), 'istanbul');
  assert.equal(normalizeText('Iğdır', 'tr'), 'ığdır');
  assert.equal(normalizeText('İyi', 'tr-TR'), 'iyi');
  assert.equal(normalizeText('BAKI', 'az'), 'bakı');
  assert.equal(normalizeText('ışık', 'tr'), 'ışık');
  // in English the capital of i is I
  assert.equal(normalizeText('ICE', 'en'), 'ice');
  assert.equal(normalizeText('ICE'), 'ice');
  // the same letters, two languages: two keys, never one answer for both
  assert.notEqual(cacheKey({ provider: 'p', source: 'tr', target: 'en', text: 'KIR' }), cacheKey({ provider: 'p', source: 'en', target: 'tr', text: 'KIR' }));
  assert.equal(cacheKey({ provider: 'p', source: 'tr', target: 'en', text: 'IŞIK' }), cacheKey({ provider: 'p', source: 'tr', target: 'en', text: 'ışık' }));
  assert.notEqual(cacheKey({ provider: 'p', source: 'tr', target: 'en', text: 'ışık' }), cacheKey({ provider: 'p', source: 'tr', target: 'en', text: 'işik' }), 'ı and i stay two letters');
});

test('the page and the background script spell keys the same way', () => {
  const WV = loadScripts(['shared/translate-client.js'], { WV: { send: async () => ({}) }, chrome: { storage: { onChanged: { addListener() {} } } }, Date, JSON, Promise });
  const samples = [['  Book, ', ''], ['IŞIK', 'tr'], ['İSTANBUL', 'tr'], ['ICE', 'en'], ['café', 'fr'], ['“Quoted”', 'en'], ['...', ''], ["don't!", 'en'], ['BAKI', 'az-AZ'], ['ÜBER', 'de'], ['同步。', 'zh-CN']];
  for (const [text, lang] of samples) assert.equal(WV.translateClient.normalizeText(text, lang), normalizeText(text, lang), `${text} (${lang})`);
});

test('spellings of one text are one entry and one request; the key holds text, both languages and the service', async () => {
  const first = await ask(LONG);
  const calls = service.calls.length;
  for (const spelling of [LONG.toUpperCase(), `  ${LONG}  `, `"${LONG}."`, LONG.normalize('NFD')]) {
    assert.equal((await ask(spelling)).translation, first.translation, spelling);
  }
  assert.equal(service.calls.length, calls, 'no further request');
  assert.deepEqual(await entries(), [['mymemory', 'en', 'tr', LONG].join('\u0001')]);
  assert.equal((await ask(`"${LONG}."`)).text, `"${LONG}."`, 'what is shown is what was picked, not the key');
});

test('the spelling saved in the vault is the one the user picked', async () => {
  await ask('İstanbul', { source: 'tr' });
  await addEntry({ text: 'İstanbul', translation: 'Istanbul', sourceLang: 'tr', targetLang: 'en', sentence: 'İstanbul\'da YAĞMUR var.', url: '', title: '' });
  const [entry] = await listEntries();
  assert.equal(entry.text, 'İstanbul');
  assert.equal(entry.sentence, 'İstanbul\'da YAĞMUR var.');
});

// --- one request for many askers ---

test('asked for five times at once: one request, five answers', async () => {
  service.hold = [];
  const all = Promise.all(Array.from({ length: 5 }, () => ask(LONG)));
  await tick();
  await tick();
  assert.equal(service.calls.length, 1);
  release();
  const results = await all;
  assert.equal(new Set(results.map((result) => result.translation)).size, 1);
  assert.equal(service.calls.length, 1);
  await ask(LONG);
  assert.equal(service.calls.length, 1, 'and afterwards the cache answers');
});

test('different texts, languages or services do not share a request', async () => {
  service.hold = [];
  const all = Promise.all([ask(LONG), ask(`${LONG} and more`), ask(LONG, { source: 'de' })]);
  await tick();
  await tick();
  assert.equal(service.calls.length, 3);
  release();
  await all;
});

// --- giving a request up ---

const settle = async () => {
  for (let index = 0; index < 6; index++) await tick();
};

test('a request that is given up is stopped, shows nothing and writes nothing to the cache', async () => {
  service.hold = [];
  const pending = ask(LONG, { requestId: 'r1' });
  await settle();
  assert.equal(cancelTranslation('r1'), true);
  await assert.rejects(pending, { code: 'aborted' });
  await settle();
  assert.equal(service.aborted, 1, 'the request itself was aborted');
  assert.deepEqual(await entries(), [], 'nothing was written');
  assert.deepEqual(Object.keys(await chrome.storage.session.get(null)), [], 'not as an answer, not as a failure');
  service.hold = null;
  assert.equal((await ask(LONG)).translation, `<${LONG}>`, 'asked for again later, it works');
});

test('given up by one of two askers: the other still gets the answer, and it is remembered', async () => {
  service.hold = [];
  const first = ask(LONG, { requestId: 'a' });
  const second = ask(LONG, { requestId: 'b' });
  await settle();
  cancelTranslation('a');
  await assert.rejects(first, { code: 'aborted' });
  assert.equal(service.aborted, 0, 'somebody is still waiting');
  release();
  assert.equal((await second).translation, `<${LONG}>`);
  assert.equal((await entries()).length, 1);
});

test('given up before it reached the service: not sent at all', async () => {
  cancelTranslation('early');
  await assert.rejects(ask(LONG, { requestId: 'early' }), { code: 'aborted' });
  assert.equal(service.calls.length, 0);
  assert.equal((await ask(LONG, { requestId: 'early' })).translation, `<${LONG}>`, 'the id is not blocked for good');
  assert.equal(cancelTranslation('nobody'), false);
  assert.equal(cancelTranslation(undefined), false);
});

// --- failures, for a moment ---

test('a used-up quota is not asked about again for a minute and a half; the error stays the same', async () => {
  service.fail = 'quota';
  const first = await ask(LONG).catch((error) => error);
  assert.equal(first.code, 'rate_limit');
  const calls = service.calls.length;
  const again = await ask(LONG).catch((error) => error);
  assert.equal(again.code, 'rate_limit');
  assert.deepEqual(again.context.provider, first.context.provider, 'with what the bubble needs to say it the same way');
  assert.equal(service.calls.length, calls, 'no second request');

  await ask(`${LONG} too`).catch(() => {});
  assert.equal(service.calls.length, calls + 1, 'another text is another request');

  service.fail = null;
  const start = realNow();
  Date.now = () => start + FAILURE_MS - 1000;
  await assert.rejects(ask(LONG), { code: 'rate_limit' });
  Date.now = () => start + FAILURE_MS + 1000;
  assert.equal((await ask(LONG)).translation, `<${LONG}>`, 'after that it is asked for again');
});

test('"Try again" asks at once, whatever is remembered', async () => {
  service.fail = 'empty';
  await assert.rejects(ask(LONG), { code: 'no_result' });
  service.fail = null;
  await assert.rejects(ask(LONG), { code: 'no_result' });
  assert.equal((await ask(LONG, { fresh: true })).translation, `<${LONG}>`);
  assert.equal((await ask(LONG)).translation, `<${LONG}>`, 'and the failure is forgotten');
});

test('no network is not remembered: the next try goes out', async () => {
  service.fail = 'network';
  await assert.rejects(ask(LONG), { code: 'network' });
  service.fail = null;
  assert.equal((await ask(LONG)).translation, `<${LONG}>`);
});

// --- the page side (shared/translate-client.js) ---

function page() {
  const sent = [];
  const waiting = [];
  const WV = loadScripts(['shared/translate-client.js'], {
    WV: {
      send: (type, payload) => {
        sent.push({ type, payload });
        if (type !== 'wv:translate') return Promise.resolve(true);
        return new Promise((resolve, reject) => waiting.push({ resolve: () => resolve({ text: payload.text, translation: `${payload.text}/tr`, saved: false }), reject }));
      },
    },
    chrome: { storage: { onChanged: { addListener() {} } } },
    Date,
    JSON,
    Promise,
    Math,
  });
  return { client: WV.translateClient, sent, waiting, translations: () => sent.filter((message) => message.type === 'wv:translate') };
}

test('page: the same word asked for twice while the first is under way is one message', async () => {
  const { client, waiting, translations } = page();
  const both = Promise.all([client.translate({ text: 'lantern' }), client.translate({ text: 'Lantern,' })]);
  await tick();
  assert.equal(translations().length, 1);
  waiting[0].resolve();
  const [first, second] = await both;
  assert.equal(first.translation, second.translation);
});

test('page: moving on gives the request up, tells the background script, and keeps nothing', async () => {
  const { client, sent, waiting, translations } = page();
  const controller = new AbortController();
  const pending = client.translate({ text: 'lantern' }, { signal: controller.signal });
  await tick();
  controller.abort();
  await assert.rejects(pending, { code: 'aborted' });
  const cancel = sent.find((message) => message.type === 'wv:translate:cancel');
  assert.equal(cancel.payload.requestId, translations()[0].payload.requestId, 'the request that was sent is the one given up');
  waiting[0].resolve(); // the answer arrives after all
  await tick();
  assert.equal(client.size(), 0, 'an answer nobody waited for is not kept');
  const next = client.translate({ text: 'lantern' });
  await tick();
  assert.equal(translations().length, 2, 'asked for again, it is a new request');
  waiting[1].resolve();
  assert.equal((await next).translation, 'lantern/tr');
  await assert.rejects(client.translate({ text: 'x' }, { signal: controller.signal }), { code: 'aborted' }, 'a signal that is already aborted sends nothing');
});

test('page: one of two askers leaving does not cancel the other', async () => {
  const { client, sent, waiting } = page();
  const controller = new AbortController();
  const first = client.translate({ text: 'lantern' }, { signal: controller.signal });
  const second = client.translate({ text: 'lantern' });
  await tick();
  controller.abort();
  await assert.rejects(first, { code: 'aborted' });
  assert.equal(sent.filter((message) => message.type === 'wv:translate:cancel').length, 0);
  waiting[0].resolve();
  assert.equal((await second).translation, 'lantern/tr');
  assert.equal(client.size(), 1);
});

test('page: "Try again" goes to the background script even with an answer in memory', async () => {
  const { client, waiting, translations } = page();
  const first = client.translate({ text: 'lantern' });
  await tick();
  waiting[0].resolve();
  await first;
  const again = client.translate({ text: 'lantern', fresh: true });
  await tick();
  assert.equal(translations().length, 2);
  assert.equal(translations()[1].payload.fresh, true);
  waiting[1].resolve();
  await again;
});

test('the pointer has to rest on a word before anything is asked for', () => {
  const timers = [];
  const shown = [];
  const WV = loadScripts(['core/hover/tracker.js']);
  const tracker = WV.createHoverTracker({ onShow: (hit) => shown.push(hit.key), setTimer: (fn, ms) => timers.push({ fn, ms }) - 1, clearTimer: (id) => (timers[id].fn = () => {}) });
  tracker.move({ key: 'a' });
  tracker.move({ key: 'b' });
  tracker.move({ key: 'c' });
  assert.ok(timers.every((timer) => timer.ms >= 150 && timer.ms <= 250), 'the wait is one constant, 150 to 250 ms');
  timers.forEach((timer) => timer.fn());
  assert.deepEqual(shown, ['c'], 'words the pointer only passed over are never asked for');
});
