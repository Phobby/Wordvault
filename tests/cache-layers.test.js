// The layers in front of the lasting cache: a page's own memory, then what the browser holds
// for the session, then the seven-day cache, then the service. An answer found lower down is
// written to the layers above; the layers never mix services or languages; closing the browser
// empties the session layer and nothing else.

import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import { updateSettings } from '../src/lib/settings.js';
import { MAX_SESSION_ENTRIES, getSession, putSession, sessionCount } from '../src/lib/session-cache.js';
import { CACHE_KEY, MAX_AGE_MS, TOUCH_AFTER_MS, cacheKey, getCached } from '../src/lib/translation-cache.js';
import { clearTranslationCaches, translate, translationCacheStats } from '../src/lib/translator.js';
import { addEntry, listEntries } from '../src/lib/vault.js';
import { createDevice, use } from './helpers/chrome.js';
import { loadScripts } from './helpers/hover.js';

let device;
let asked; // texts the stand-in service was asked for
const realFetch = globalThis.fetch;
const realNow = Date.now;

beforeEach(async () => {
  device = use(createDevice('device', { uiLanguage: 'en-US' }));
  asked = [];
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    asked.push(url.searchParams.get('q'));
    return { status: 200, json: async () => ({ responseData: { translatedText: `${url.searchParams.get('q')}>${url.searchParams.get('langpair')}`, detectedLanguage: 'en' }, responseStatus: 200, responseDetails: '', matches: [] }) };
  };
  await updateSettings({ targetLang: 'tr' });
});
afterEach(() => {
  globalThis.fetch = realFetch;
  Date.now = realNow;
});

const lookup = (text) => translate({ text, source: 'en' }, 'example.com');
const KEY = cacheKey({ provider: 'mymemory', source: 'en', target: 'tr', text: 'lantern' });

test('a new answer is written to the session layer and to the lasting cache', async () => {
  await lookup('lantern');
  assert.ok((await getSession(KEY))?.result.translation.startsWith('lantern>'));
  assert.ok(await getCached({ provider: 'mymemory', source: 'en', target: 'tr', text: 'lantern' }));
  assert.deepEqual(await translationCacheStats().then(({ entries, session, hasSession }) => ({ entries, session, hasSession })), { entries: 1, session: 1, hasSession: true });
});

test('the session layer answers before the lasting cache is read, and without the service', async () => {
  await lookup('lantern');
  const calls = asked.length;
  // the lasting cache says something else now: if it were read, the answer would change
  const state = (await chrome.storage.local.get(CACHE_KEY))[CACHE_KEY];
  state.entries[KEY].result.translation = 'FROM THE LASTING CACHE';
  await chrome.storage.local.set({ [CACHE_KEY]: state });
  assert.match((await lookup('lantern')).translation, /^lantern>/);
  assert.equal(asked.length, calls);
});

test('closing the browser empties the session layer; the lasting cache answers and fills it again', async () => {
  await lookup('lantern');
  const calls = asked.length;
  device.restartBrowser();
  assert.equal(await getSession(KEY), null);
  assert.match((await lookup('lantern')).translation, /^lantern>/);
  assert.equal(asked.length, calls, 'no request: the lasting cache had it');
  assert.ok(await getSession(KEY), 'written back up');
});

test('without session storage the layer is skipped and everything else works', async () => {
  delete globalThis.chrome.storage.session;
  await lookup('lantern');
  const calls = asked.length;
  await lookup('lantern');
  assert.equal(asked.length, calls);
  assert.deepEqual(await translationCacheStats().then(({ session, hasSession }) => ({ session, hasSession })), { session: 0, hasSession: false });
});

test('the layers keep services and languages apart', async () => {
  await lookup('lantern');
  await updateSettings({ targetLang: 'de' });
  assert.match((await lookup('lantern')).translation, /\|de$/, 'another target language is another entry in every layer');
  await updateSettings({ targetLang: 'tr' });
  assert.match((await lookup('lantern')).translation, /\|tr$/);
  assert.notEqual(cacheKey({ provider: 'deepl', source: 'en', target: 'tr', text: 'lantern' }), KEY);
  assert.equal(await getSession(cacheKey({ provider: 'deepl', source: 'en', target: 'tr', text: 'lantern' })), null);
});

test('an answer served from the session still counts as asked for in the lasting cache', async () => {
  const start = realNow();
  await lookup('lantern');
  // used every day for ten days with the browser left open: the session layer answers each time
  for (let day = 1; day <= 10; day++) {
    Date.now = () => start + day * 24 * 60 * 60 * 1000;
    await lookup('lantern');
  }
  const seen = (await chrome.storage.local.get(CACHE_KEY))[CACHE_KEY].entries[KEY].seen;
  assert.ok(Date.now() - seen < TOUCH_AFTER_MS, 'its seven days were started again');
  assert.equal(asked.filter((text) => text === 'lantern').length <= 2, true, 'the service was not asked again in ten days');
  assert.ok(MAX_AGE_MS > 0);
});

test('the session layer is bounded: over its limit it is emptied, the lasting cache keeps everything', async () => {
  for (let index = 0; index <= MAX_SESSION_ENTRIES; index++) await putSession(`key ${index}`, { translation: 'x' });
  assert.equal(await sessionCount(), 1);
  await chrome.storage.session.set({ syncSecret: 'kept' });
  await clearTranslationCaches();
  assert.deepEqual(await chrome.storage.session.get(null), { syncSecret: 'kept' }, 'other things held for the session are not touched');
});

test('"Clear cache" empties every layer and leaves the vault alone', async () => {
  await addEntry({ text: 'book', translation: 'kitap', sourceLang: 'en', targetLang: 'tr', sentence: '', url: '', title: '' });
  await lookup('lantern');
  const calls = asked.length;
  await clearTranslationCaches();
  assert.deepEqual(await translationCacheStats().then(({ entries, session }) => ({ entries, session })), { entries: 0, session: 0 });
  assert.ok((await chrome.storage.local.get('translationCacheEpoch')).translationCacheEpoch > 0, 'pages are told to drop what they hold');
  await lookup('lantern');
  assert.ok(asked.length > calls, 'asked for again');
  assert.deepEqual((await listEntries()).map((entry) => entry.text), ['book']);
});

// --- the page's own memory (shared/translate-client.js) ---

function page() {
  const sent = [];
  const listeners = [];
  let clock = 1_800_000_000_000;
  const WV = loadScripts(['shared/translate-client.js'], {
    WV: {
      send: async (type, payload) => {
        sent.push(payload);
        return { text: payload.text, translation: `${payload.text}/tr#${sent.length}`, provider: { id: 'mymemory', name: 'MyMemory' }, saved: false };
      },
    },
    chrome: { storage: { onChanged: { addListener: (listener) => listeners.push(listener) } } },
    Date: { now: () => clock },
    JSON,
  });
  return { client: WV.translateClient, sent, change: (keys, area = 'local') => listeners.forEach((listener) => listener(Object.fromEntries(keys.map((key) => [key, {}])), area)), advance: (ms) => (clock += ms) };
}

test('a page answers the same request from its own memory, without asking the background script', async () => {
  const { client, sent } = page();
  const request = { text: 'lantern', sample: 'A lantern in the dark.', pageLang: 'en', source: null };
  const first = await client.translate(request);
  const second = await client.translate({ ...request });
  assert.equal(sent.length, 1);
  assert.equal(second.translation, first.translation);
  assert.equal(second.from, 'memory');
  assert.equal((await client.translate({ ...request, text: '  lantern ' })).from, 'memory', 'spaces around the text do not matter');
});

test('the memory is used only when nothing that decides the answer differs', async () => {
  const { client, sent } = page();
  const request = { text: 'gift', sample: 'A gift for you.', pageLang: 'en', source: null };
  await client.translate(request);
  await client.translate({ ...request, sample: 'Das Gift ist gefährlich.' }); // other surroundings: the language may be another
  await client.translate({ ...request, source: 'de' });
  await client.translate({ ...request, pageLang: 'de' });
  await client.translate({ ...request, provider: 'mymemory' });
  assert.equal(sent.length, 5);
});

test('the memory holds about 200 answers and drops the least recently used', async () => {
  const { client, sent } = page();
  for (let index = 0; index < client.MEMORY_ENTRIES; index++) await client.translate({ text: `word ${index}` });
  await client.translate({ text: 'word 0' }); // used again: no longer the oldest
  await client.translate({ text: 'one more' });
  assert.equal(client.size(), client.MEMORY_ENTRIES);
  const before = sent.length;
  await client.translate({ text: 'word 0' });
  assert.equal(sent.length, before, 'still there');
  await client.translate({ text: 'word 1' });
  assert.equal(sent.length, before + 1, 'the least recently used was dropped');
});

test('the memory is emptied by anything that could change an answer, and ages out after an hour', async () => {
  const { client, sent, change, advance } = page();
  const again = async () => {
    const before = sent.length;
    await client.translate({ text: 'lantern' });
    return sent.length > before;
  };
  await client.translate({ text: 'lantern' });
  assert.equal(await again(), false);
  for (const key of ['settings', 'siteSourceLangs', 'vault:en|tr|lantern', 'tomb:en|tr|lantern', 'translationCacheEpoch']) {
    change([key]);
    assert.equal(await again(), true, key);
  }
  change(['translationCache', 'quizState']);
  assert.equal(await again(), false, 'the cache being written to is not a reason');
  change(['settings'], 'sync');
  assert.equal(await again(), false);
  advance(client.MEMORY_MS);
  assert.equal(await again(), true, 'after an hour the background script is asked, which keeps the lasting entry alive');
});

test('an answer with letters missing is not kept in memory', async () => {
  const WV = loadScripts(['shared/translate-client.js'], { WV: { send: async () => ({ translation: 'e?itle', damaged: true }) }, chrome: { storage: { onChanged: { addListener() {} } } }, Date, JSON });
  await WV.translateClient.translate({ text: 'sync' });
  assert.equal(WV.translateClient.size(), 0);
});
