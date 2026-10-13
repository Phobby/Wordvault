// Choosing the translation service: DeepL with the user's own key next to MyMemory. Where a key
// goes (one header) and where it never goes (backup, synchronisation, feedback, the error log),
// which address a key belongs to, language codes, what errors mean, that nothing is switched
// silently, and that the answers of two services are remembered apart.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, test } from 'node:test';

import { makeRecord, scrub } from '../src/features/feedback/error-log.js';
import { buildPayload, checkPayload } from '../src/features/feedback/payload.js';
import { featureFlags } from '../src/features/feedback/tech-info.js';
import { createBackup } from '../src/lib/backup.js';
import { updateSettings } from '../src/lib/settings.js';
import { cacheKey } from '../src/lib/translation-cache.js';
import { checkProvider, getPreferences, translate } from '../src/lib/translator.js';
import { addEntry } from '../src/lib/vault.js';
import { deepl, deeplBase, deeplOrigin, fromDeepl, toDeeplSource, toDeeplTarget } from '../src/providers/deepl.js';
import { DEFAULT_PROVIDER_ID, getProvider, listProviders } from '../src/providers/index.js';
import { encodeDocument } from '../src/sync/codec.js';
import { readLocalDocument } from '../src/sync/local.js';
import { createDevice, use } from './helpers/chrome.js';

const FREE_KEY = '0a1b2c3d-1111-2222-3333-444455556666:fx';
const PRO_KEY = '9f8e7d6c-aaaa-bbbb-cccc-ddddeeeeffff';

let device;
let calls; // every request that left, as { url, method, headers, body }
let deeplAnswers; // what the stand-in DeepL says: a status, or a function
let allowedOrigins;
const realFetch = globalThis.fetch;

const useDeepl = (apiKey = FREE_KEY, more = {}) => updateSettings({ provider: 'deepl', providerConfig: { deepl: { apiKey } }, targetLang: 'tr', ...more });
const deeplCalls = () => calls.filter((call) => call.url.host.includes('deepl.com'));
const myMemoryCalls = () => calls.filter((call) => call.url.host.includes('mymemory'));

beforeEach(() => {
  device = use(createDevice('device', { uiLanguage: 'en-US', detect: () => null }));
  calls = [];
  deeplAnswers = { status: 200 };
  allowedOrigins = new Set(['https://api-free.deepl.com/*', 'https://api.deepl.com/*']);
  globalThis.chrome.permissions.contains = async ({ origins }) => origins.every((origin) => allowedOrigins.has(origin));
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input);
    const call = { url, method: init.method || 'GET', headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : null };
    calls.push(call);
    const json = (status, body) => ({ status, json: async () => body });
    if (url.host.includes('mymemory')) {
      return json(200, { responseData: { translatedText: `${url.searchParams.get('q')}/mymemory`, detectedLanguage: 'en' }, responseStatus: 200, responseDetails: '', matches: [] });
    }
    if (deeplAnswers.status instanceof Error) throw deeplAnswers.status;
    if (deeplAnswers.status !== 200) return json(deeplAnswers.status, deeplAnswers.body || { message: 'no' });
    if (url.pathname === '/v2/usage') return json(200, deeplAnswers.usage || { character_count: 1234, character_limit: 500000 });
    return json(200, { translations: [{ detected_source_language: call.body.source_lang || 'EN', text: `${call.body.text[0]}/deepl>${call.body.target_lang}` }] });
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

// --- the registry ---

test('two services: MyMemory is the default and needs nothing, DeepL needs a key', () => {
  assert.deepEqual(listProviders().map((provider) => provider.id), ['mymemory', 'deepl']);
  assert.equal(DEFAULT_PROVIDER_ID, 'mymemory');
  assert.deepEqual(getProvider('mymemory').configFields, []);
  assert.deepEqual(getProvider('deepl').configFields.map((field) => [field.key, field.type]), [['apiKey', 'password']]);
  assert.equal(getProvider('something else').id, 'mymemory', 'an unknown choice is the default');
});

// --- DeepL: addresses, the header, language codes ---

test('a key ending in ":fx" belongs to the free address, any other to the paid one', () => {
  assert.equal(deeplBase(FREE_KEY), 'https://api-free.deepl.com');
  assert.equal(deeplBase(`  ${FREE_KEY}  `), 'https://api-free.deepl.com');
  assert.equal(deeplBase(PRO_KEY), 'https://api.deepl.com');
  assert.equal(deeplOrigin(FREE_KEY), 'https://api-free.deepl.com/*');
  assert.equal(deeplOrigin(PRO_KEY), 'https://api.deepl.com/*');
});

test('the key travels in the Authorization header and nowhere else', async () => {
  await useDeepl(FREE_KEY);
  const result = await translate({ text: 'serendipity', source: 'en' }, 'example.com');
  assert.equal(result.translation, 'serendipity/deepl>TR');
  assert.deepEqual(result.provider, { id: 'deepl', name: 'DeepL' });
  const [call] = deeplCalls();
  assert.equal(call.url.href, 'https://api-free.deepl.com/v2/translate');
  assert.equal(call.method, 'POST');
  assert.equal(call.headers.Authorization, `DeepL-Auth-Key ${FREE_KEY}`);
  assert.deepEqual(call.body, { text: ['serendipity'], target_lang: 'TR', source_lang: 'EN' });
  assert.ok(!call.url.href.includes(FREE_KEY) && !JSON.stringify(call.body).includes(FREE_KEY));
  assert.equal(myMemoryCalls().length, 0, 'the other service is not asked');

  await useDeepl(PRO_KEY);
  await translate({ text: 'another word', source: 'en' }, 'example.com');
  assert.equal(deeplCalls().at(-1).url.href, 'https://api.deepl.com/v2/translate');
});

test('language codes are turned into DeepL\'s, with the regional variants it asks for', () => {
  assert.deepEqual(['en', 'en-GB', 'pt', 'pt-BR', 'zh-CN', 'zh-TW', 'no', 'tr', 'de'].map(toDeeplTarget), ['EN-US', 'EN-GB', 'PT-PT', 'PT-BR', 'ZH-HANS', 'ZH-HANT', 'NB', 'TR', 'DE']);
  assert.deepEqual(['en', 'en-GB', 'pt-BR', 'zh-CN', 'zh-TW', 'no', 'tr'].map(toDeeplSource), ['EN', 'EN', 'PT', 'ZH', 'ZH', 'NB', 'TR'], 'variants are targets only');
  assert.deepEqual(['EN', 'NB', 'ZH', 'PT', 'ZH-HANT', ''].map(fromDeepl), ['en', 'no', 'zh-CN', 'pt', 'zh-TW', '']);
});

test('without a source language DeepL detects it, and says which', async () => {
  await useDeepl();
  const result = await translate({ text: 'Schmetterling' }, 'example.com');
  assert.ok(!('source_lang' in deeplCalls()[0].body));
  assert.equal(result.sourceLang, 'en', 'what the service detected');
});

// --- errors: what they mean, and that nothing is switched silently ---

test('errors of DeepL are told apart, and none of them carries the key', async () => {
  await useDeepl();
  const failing = async (status, body) => {
    deeplAnswers = { status, body };
    return translate({ text: `word ${String(status)}`, source: 'en' }, 'example.com').then(() => null, (error) => error);
  };
  for (const [status, code] of [[403, 'auth'], [456, 'quota'], [429, 'rate_limit'], [529, 'rate_limit'], [500, 'provider_error'], [new TypeError('Failed to fetch'), 'network']]) {
    const error = await failing(status);
    assert.equal(error.code, code, String(status));
    assert.deepEqual(error.context.provider, { id: 'deepl', name: 'DeepL' });
    assert.deepEqual(error.context.fallback, { id: 'mymemory', name: 'MyMemory' }, 'the default is offered');
    assert.ok(!JSON.stringify([error.message, error.detail, error.context, makeRecord('translate', error)]).includes(FREE_KEY.slice(0, 12)));
  }
  assert.equal((await failing(400, { message: 'Value for "target_lang" not supported.' })).code, 'unsupported_language');
  assert.equal(myMemoryCalls().length, 0, 'the other service was never asked on its own');
});

test('"continue with MyMemory" is one request with the other service; the setting stays', async () => {
  await useDeepl();
  deeplAnswers = { status: 456 };
  await assert.rejects(translate({ text: 'book', source: 'en' }, 'example.com'), { code: 'quota' });
  const result = await translate({ text: 'book', source: 'en', provider: 'mymemory' }, 'example.com');
  assert.deepEqual(result.provider, { id: 'mymemory', name: 'MyMemory' }, 'the result says which service it was');
  assert.match(result.translation, /mymemory/);
  assert.equal((await chrome.storage.local.get('settings')).settings.provider, 'deepl');
  await assert.rejects(translate({ text: 'book', source: 'en' }, 'example.com'), { code: 'quota' }, 'the next lookup asks the chosen service again');
});

test('MyMemory failing offers no other service', async () => {
  await updateSettings({ provider: 'mymemory', targetLang: 'tr' });
  globalThis.fetch = async () => {
    throw new TypeError('Failed to fetch');
  };
  const error = await translate({ text: 'book', source: 'en' }, 'example.com').catch((caught) => caught);
  assert.equal(error.code, 'network');
  assert.equal(error.context.fallback, null);
});

test('no key, or the host not allowed yet: said, and nothing is sent', async () => {
  await useDeepl('');
  await assert.rejects(translate({ text: 'book', source: 'en' }, 'example.com'), { code: 'no_key' });
  await useDeepl(FREE_KEY);
  allowedOrigins.clear();
  await assert.rejects(translate({ text: 'book', source: 'en' }, 'example.com'), { code: 'provider_permission' });
  allowedOrigins.add('https://api.deepl.com/*');
  await assert.rejects(translate({ text: 'book', source: 'en' }, 'example.com'), { code: 'provider_permission' }, 'the paid address does not cover a free key');
  assert.equal(calls.length, 0);
});

test('a target language DeepL does not have is an error that names it, not another language', async () => {
  await useDeepl(FREE_KEY, { targetLang: 'az' });
  const error = await translate({ text: 'book', source: 'en' }, 'example.com').catch((caught) => caught);
  assert.equal(error.code, 'provider_language');
  assert.equal(error.detail, 'az');
  assert.deepEqual(error.context.fallback, { id: 'mymemory', name: 'MyMemory' });
  assert.equal(calls.length, 0, 'nothing was translated into some other language');
  // MyMemory has it
  assert.match((await translate({ text: 'book', source: 'en', provider: 'mymemory' }, 'example.com')).translation, /mymemory/);
  assert.equal(myMemoryCalls()[0].url.searchParams.get('langpair'), 'en|az');
  assert.ok(!(await getPreferences()).languages.includes('az'), 'the language list is the chosen service\'s');
});

// --- "Test key" ---

test('testing a key asks for the usage and translates nothing', async () => {
  assert.deepEqual(await checkProvider('deepl', { apiKey: FREE_KEY }), { plan: 'free', used: 1234, limit: 500000 });
  assert.deepEqual(await checkProvider('deepl', { apiKey: PRO_KEY }), { plan: 'pro', used: 1234, limit: 500000 });
  assert.deepEqual(calls.map((call) => `${call.method} ${call.url.href}`), ['GET https://api-free.deepl.com/v2/usage', 'GET https://api.deepl.com/v2/usage']);
  assert.equal(calls[0].headers.Authorization, `DeepL-Auth-Key ${FREE_KEY}`);
  deeplAnswers = { status: 403 };
  await assert.rejects(checkProvider('deepl', { apiKey: 'wrong' }), { code: 'auth' });
  deeplAnswers = { status: 200, usage: { character_count: 500000, character_limit: 500000 } };
  await assert.rejects(checkProvider('deepl', { apiKey: FREE_KEY }), { code: 'quota' }, 'a valid key with nothing left');
  deeplAnswers = { status: new TypeError('Failed to fetch') };
  await assert.rejects(checkProvider('deepl', { apiKey: FREE_KEY }), { code: 'network' });
  await assert.rejects(checkProvider('deepl', {}), { code: 'no_key' });
  await assert.rejects(checkProvider('mymemory', {}), { code: 'provider_error' }, 'nothing to test there');
});

// --- the cache ---

test('a translation is remembered per service: the same text is not asked for twice, and two services do not mix', async () => {
  await useDeepl();
  const first = await translate({ text: 'habit', source: 'en' }, 'example.com');
  const again = await translate({ text: 'habit', source: 'en' }, 'example.com');
  assert.equal(deeplCalls().length, 1);
  assert.deepEqual(again, first);

  const other = await translate({ text: 'habit', source: 'en', provider: 'mymemory' }, 'example.com');
  assert.match(other.translation, /mymemory/, 'not DeepL\'s remembered answer');
  assert.ok(myMemoryCalls().length > 0);
  assert.equal((await translate({ text: 'habit', source: 'en' }, 'example.com')).translation, 'habit/deepl>TR', 'and not the other way round');

  await updateSettings({ targetLang: 'de' });
  assert.equal((await translate({ text: 'habit', source: 'en' }, 'example.com')).translation, 'habit/deepl>DE', 'another language pair is another entry');
  assert.notEqual(cacheKey({ provider: 'deepl', source: 'en', target: 'tr', text: 'a' }), cacheKey({ provider: 'mymemory', source: 'en', target: 'tr', text: 'a' }));
  assert.notEqual(cacheKey({ provider: 'deepl', source: null, target: 'tr', text: 'a' }), cacheKey({ provider: 'deepl', source: 'en', target: 'tr', text: 'a' }));
});

test('a failure is never remembered as an answer', async () => {
  await useDeepl();
  deeplAnswers = { status: 429 };
  await assert.rejects(translate({ text: 'later', source: 'en' }, 'example.com'), { code: 'rate_limit' });
  deeplAnswers = { status: 200 };
  // "Try again" asks the service again at once (see tests/request-optimisation.test.js for the short memory of failures)
  assert.equal((await translate({ text: 'later', source: 'en', fresh: true }, 'example.com')).translation, 'later/deepl>TR');
});

// --- where the key never goes ---

test('the key is in the settings in local storage, and in nothing that leaves the device', async () => {
  await useDeepl(FREE_KEY);
  await addEntry({ text: 'book', translation: 'kitap', sourceLang: 'en', targetLang: 'tr', sentence: 'A good book.', url: 'https://example.com/', title: 'Example' });
  await translate({ text: 'serendipity', source: 'en' }, 'example.com');
  const secret = FREE_KEY.slice(0, 20);

  assert.ok(JSON.stringify((await chrome.storage.local.get('settings')).settings).includes(secret), 'it is where it should be');
  assert.ok(!JSON.stringify(await chrome.storage.sync.get(null)).includes(secret), 'not in the browser\'s synchronised storage');

  const backup = JSON.stringify(await createBackup());
  assert.ok(backup.includes('kitap') && !backup.includes(secret), 'not in the backup / JSON export');
  assert.ok(!/providerConfig|apiKey|translationCache/.test(backup));

  const document = await readLocalDocument();
  const plain = JSON.stringify(document);
  assert.ok(plain.includes('kitap') && !plain.includes(secret), 'not in the synchronised document');
  assert.ok(!/providerConfig|apiKey|serendipity\/deepl/.test(plain), 'nor the settings or the translation cache');
  assert.ok((await encodeDocument(document)).byteLength > 0);

  const settings = (await chrome.storage.local.get('settings')).settings;
  const flags = featureFlags(settings, { mode: 'off' });
  const payload = buildPayload({ draft: { type: 'bug', feature: 'bubble', message: 'DeepL says the key is wrong.' }, tech: { browser: 'Zen', features: flags, syncMode: 'off' }, errors: [makeRecord('translate', new Error(`request failed with DeepL-Auth-Key ${FREE_KEY}`))] });
  assert.ok(!JSON.stringify(payload).includes(secret), 'not in feedback, with technical information and error records');
  assert.equal(checkPayload({ ...payload, tech: { ...payload.tech, apiKey: FREE_KEY } }), 'tech', 'and feedback could not carry it if something tried');
});

test('the error log would not keep a key even if an error contained one', () => {
  assert.equal(scrub(`Authorization: DeepL-Auth-Key ${FREE_KEY}`), 'Authorization: DeepL-Auth-Key [key]');
  assert.equal(scrub(`bad key ${PRO_KEY} given`), 'bad key [key] given');
  assert.equal(scrub(`key ${FREE_KEY}`), 'key [key]');
});

test('the key is used in one module and requested for no host at installation', () => {
  const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  assert.match(read('src/providers/deepl.js'), /Authorization: `DeepL-Auth-Key \$\{apiKey\}`/);
  for (const path of ['src/lib/backup.js', 'src/sync/local.js', 'src/sync/model.js', 'src/features/feedback/tech-info.js', 'src/features/feedback/payload.js']) {
    assert.ok(!/providerConfig|apiKey/.test(read(path)), `${path} does not touch the key`);
  }
  for (const target of ['chrome', 'firefox']) {
    const manifest = JSON.parse(read(`manifest.${target}.json`));
    assert.ok(!manifest.host_permissions.some((origin) => origin.includes('deepl')), 'DeepL is asked for only when the user sets it up');
  }
});

test('DeepL\'s languages are a subset the settings can check a target against', async () => {
  const languages = await deepl.getLanguages();
  assert.ok(['en', 'tr', 'de', 'pt-BR', 'zh-CN'].every((code) => languages.includes(code)));
  assert.ok(!languages.includes('az'));
});
