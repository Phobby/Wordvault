// Feedback: what is collected, what the body looks like, what the local error log keeps, and
// when something is sent (never without a configured receiver, a valid body and permission).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { beforeEach, test } from 'node:test';

import { feedbackEndpoint } from '../src/config.js';
import { MAX_RECORDS, getErrorLog, makeRecord, pushRecord, recordError, scrub } from '../src/features/feedback/error-log.js';
import { LIMITS, buildPayload, checkPayload, cleanText, validateDraft } from '../src/features/feedback/payload.js';
import { COOLDOWN_MS, cooldownLeft, endpointOrigin, sendFeedback } from '../src/features/feedback/send.js';
import { detectBrowser, featureFlags } from '../src/features/feedback/tech-info.js';

const ENDPOINT = 'https://feedback.example.workers.dev/feedback';
const draft = (patch = {}) => ({ type: 'bug', feature: 'quiz', message: 'The card is cut off on the left.', email: '', ...patch });
const tech = () => ({ browser: 'Zen', browserVersion: '1.16', engine: 'Gecko 143.0', os: 'macOS', extensionVersion: '0.1.0', uiLanguage: 'en-US', features: { quiz: true, sync: false }, syncMode: 'off' });

let store;
let granted;
beforeEach(() => {
  store = new Map();
  granted = true;
  globalThis.chrome = {
    storage: {
      local: {
        get: async (key) => (store.has(key) ? { [key]: structuredClone(store.get(key)) } : {}),
        set: async (items) => Object.entries(items).forEach(([key, value]) => store.set(key, structuredClone(value))),
        remove: async (key) => void store.delete(key),
      },
    },
    permissions: { contains: async () => granted },
  };
});

// --- configuration ---

test('the receiver is https (http only on this computer); the placeholder is no receiver', () => {
  const configured = feedbackEndpoint();
  assert.ok(configured === '' || new URL(configured).protocol === 'https:', 'what is shipped is https or nothing');
  assert.equal(feedbackEndpoint(ENDPOINT), ENDPOINT);
  assert.equal(feedbackEndpoint('http://localhost:8787/feedback'), 'http://localhost:8787/feedback');
  for (const value of ['', 'https://YOUR_WORKER.workers.dev/feedback', 'http://example.com/feedback', 'mailto:someone@example.com', 'javascript:alert(1)']) {
    assert.equal(feedbackEndpoint(value), '', value);
  }
  assert.equal(endpointOrigin(ENDPOINT), 'https://feedback.example.workers.dev/*', 'permission for that host only');
  assert.equal(endpointOrigin('http://localhost:8787/feedback'), 'http://localhost/*');
});

// --- the body ---

test('a draft is checked: type, feature, 10 to 1500 characters, e-mail optional', () => {
  assert.deepEqual(validateDraft(draft()), []);
  assert.deepEqual(validateDraft(draft({ message: 'too short' })), ['message_short']);
  assert.deepEqual(validateDraft(draft({ message: '   spaces do not count   \n\n' + ' '.repeat(40) })), []);
  assert.deepEqual(validateDraft(draft({ message: 'x'.repeat(LIMITS.messageMax + 1) })), ['message_long']);
  assert.deepEqual(validateDraft(draft({ message: 'ş'.repeat(LIMITS.messageMax) })), [], 'characters, not bytes');
  assert.deepEqual(validateDraft(draft({ type: 'spam', feature: 'nothing' })), ['type', 'feature']);
  assert.deepEqual(validateDraft(draft({ email: 'someone@example.com' })), []);
  assert.deepEqual(validateDraft(draft({ email: 'not an address' })), ['email']);
});

test('the body holds what the user chose and nothing else', () => {
  const plain = buildPayload({ draft: draft({ message: '  Line one\r\nline two\u0000\u0007  ' }) });
  assert.deepEqual(plain, { v: 1, type: 'bug', feature: 'quiz', message: 'Line one\nline two' });
  assert.equal(cleanText('a\u0001b\tc'), 'ab\tc');

  const full = buildPayload({ draft: draft({ email: ' someone@example.com ' }), tech: tech(), errors: [makeRecord('sync', new Error('boom'), 5)] });
  assert.deepEqual(Object.keys(full), ['v', 'type', 'feature', 'message', 'email', 'tech', 'errors']);
  assert.equal(full.email, 'someone@example.com');
  assert.equal(checkPayload(full), '');
  assert.equal(checkPayload(plain), '');
  assert.ok(!('errors' in buildPayload({ draft: draft(), errors: [] })), 'an empty log adds nothing');
});

test('what does not have the shape of the body is not sent', () => {
  const good = buildPayload({ draft: draft(), tech: tech() });
  assert.equal(checkPayload({ ...good, url: 'https://example.com/page' }), 'shape');
  assert.equal(checkPayload({ ...good, tech: { ...good.tech, installId: 'abc' } }), 'tech');
  assert.equal(checkPayload({ ...good, tech: { ...good.tech, features: { quiz: 'book, house' } } }), 'tech', 'features are yes or no');
  assert.equal(checkPayload({ ...good, errors: [{ at: 1, feature: 'x', message: 'm', stack: '', page: 'https://example.com' }] }), 'errors');
  assert.equal(checkPayload({ ...good, message: 'short' }), 'message_short');
  assert.equal(checkPayload(null), 'shape');
});

test('the body stays within the size the receiver takes: old error records give way', () => {
  const many = Array.from({ length: 20 }, (_, index) => makeRecord('background', Object.assign(new Error(`e${index} ${'x'.repeat(190)}`), { stack: `Error\n${'    at somewhere (chrome-extension://abcdefghijklmnopabcdefghijklmnop/background/background.js:1:1)\n'.repeat(4)}` }), index));
  const payload = buildPayload({ draft: draft({ message: 'ş'.repeat(1500) }), tech: tech(), errors: many });
  assert.ok(new TextEncoder().encode(JSON.stringify(payload)).length <= LIMITS.bytes);
  assert.ok(payload.errors.length > 0 && payload.errors.length < 20);
  assert.equal(payload.errors.at(-1).at, 19, 'the newest are kept');
  assert.equal(checkPayload(payload), '');
});

// --- technical information ---

test('browsers are told apart, also those built on another one', () => {
  const chromeUa = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
  const brands = (name, version = '141') => [{ brand: 'Not?A_Brand', version: '8' }, { brand: 'Chromium', version: '141' }, ...(name ? [{ brand: name, version }] : [])];
  assert.deepEqual(detectBrowser({ userAgent: chromeUa, brands: brands('Google Chrome') }), { browser: 'Chrome', browserVersion: '141', engine: 'Chromium 141.0.0.0' });
  assert.equal(detectBrowser({ userAgent: `${chromeUa} Edg/141.0.3537.57`, brands: brands('Microsoft Edge') }).browser, 'Edge');
  assert.equal(detectBrowser({ userAgent: `${chromeUa} Edg/141.0.3537.57` }).browserVersion, '141.0.3537.57', 'from the user agent alone');
  assert.equal(detectBrowser({ userAgent: chromeUa, brands: brands('Brave') }).browser, 'Brave');
  assert.equal(detectBrowser({ userAgent: chromeUa, brands: brands(''), brave: true }).browser, 'Brave', 'Brave says so only through navigator.brave');
  assert.equal(detectBrowser({ userAgent: `${chromeUa} OPR/120.0.0.0` }).browser, 'Opera');
  assert.equal(detectBrowser({ userAgent: `${chromeUa} Vivaldi/7.5` }).browser, 'Vivaldi');
  assert.equal(detectBrowser({ userAgent: chromeUa, brands: brands('') }).browser, 'Chromium');

  const firefoxUa = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:143.0) Gecko/20100101 Firefox/143.0';
  assert.deepEqual(detectBrowser({ userAgent: firefoxUa, browserInfo: { name: 'Firefox', version: '143.0.1' } }), { browser: 'Firefox', browserVersion: '143.0.1', engine: 'Gecko 143.0' });
  assert.deepEqual(detectBrowser({ userAgent: firefoxUa, browserInfo: { name: 'Zen', version: '1.16.2b' } }), { browser: 'Zen', browserVersion: '1.16.2b', engine: 'Gecko 143.0' });
  assert.equal(detectBrowser({ userAgent: firefoxUa }).browser, 'Firefox');
  assert.equal(detectBrowser({}).browser, 'unknown');
});

test('features are reported as yes or no, synchronisation by its kind only', () => {
  const flags = featureFlags({ doubleClick: true, quizEnabled: false, providerConfig: { deepl: { apiKey: 'secret' } }, targetLang: 'tr' }, { mode: 'cloud', providerId: 'gdrive', connection: { accessToken: 'secret' }, encryption: { enabled: true } });
  assert.ok(Object.values(flags).every((value) => typeof value === 'boolean'));
  assert.equal(flags.sync, true);
  assert.equal(flags.syncEncryption, true);
  assert.ok(!JSON.stringify(flags).includes('secret') && !JSON.stringify(flags).includes('gdrive'));
});

test('the technical information is a fixed list; nothing identifying is collected', () => {
  const source = readFileSync(new URL('../src/features/feedback/tech-info.js', import.meta.url), 'utf8');
  for (const forbidden of [/tabs\./, /location\.href/, /getProfileUserInfo/, /randomUUID/, /getRandomValues/, /installId/i, /accessToken|refreshToken|apiKey/]) {
    assert.ok(!forbidden.test(source), String(forbidden));
  }
  const feature = ['error-log.js', 'payload.js', 'send.js', 'tech-info.js'].map((name) => readFileSync(new URL(`../src/features/feedback/${name}`, import.meta.url), 'utf8')).join('\n');
  assert.ok(!/mailto:/.test(feature + readFileSync(new URL('../src/options/feedback.js', import.meta.url), 'utf8')), 'no e-mail program is opened');
});

// --- the local error log ---

test('addresses never get into the error log', () => {
  assert.equal(scrub('failed to fetch https://example.com/private/page?q=secret now'), 'failed to fetch [address] now');
  assert.equal(scrub('at run (moz-extension://0f1e2d3c-aaaa-bbbb-cccc-123456789abc/background/background.js:10:5)'), 'at run (background/background.js:10:5)', 'the per-installation part is gone');
  assert.equal(scrub('at run (chrome-extension://abcdefghijklmnopabcdefghijklmnop/lib/vault.js:3:1)'), 'at run (lib/vault.js:3:1)');
  assert.equal(scrub("Cannot read properties of undefined (reading 'length')"), "Cannot read properties of undefined (reading 'length')");
  assert.equal(scrub('Unexpected token: "a whole sentence somebody was reading on a page" is not valid JSON'), 'Unexpected token: "…" is not valid JSON');
  assert.equal(scrub('file:///Users/someone/secret.txt and blob:https://example.com/1'), '[address] and [address]');
});

test('a record is short: message, part of the extension, time, top of the stack', () => {
  const error = new TypeError(`bad thing at https://example.com/a ${'y'.repeat(400)}`);
  error.stack = `TypeError: bad thing\n${Array.from({ length: 12 }, (_, index) => `    at step${index} (chrome-extension://abcdefghijklmnopabcdefghijklmnop/sync/engine.js:${index}:1)`).join('\n')}`;
  const record = makeRecord('sync', error, 1234);
  assert.deepEqual(Object.keys(record), ['at', 'feature', 'message', 'stack']);
  assert.equal(record.at, 1234);
  assert.equal(record.feature, 'sync');
  assert.ok(record.message.startsWith('TypeError: bad thing at [address]') && record.message.length <= 200);
  assert.equal(record.stack.split('\n').length, 4);
  assert.ok(!/chrome-extension|https?:/.test(JSON.stringify(record)));
  assert.equal(makeRecord('x', 'just a string').message, 'just a string');
  assert.equal(makeRecord('x', undefined).stack, '');
  const foreign = Object.assign(new Error('x'), { stack: '@pptr:evaluate;file%3A%2F%2F%2Fhome%2Fsomeone%2Fscript.mjs:1:35\nrun@https://example.com/app.js:1:1\nrun@moz-extension://0f1e2d3c-aaaa-bbbb-cccc-123456789abc/options/options.js:5:1' });
  assert.equal(makeRecord('options', foreign).stack, 'run@options/options.js:5:1', 'lines outside the extension are dropped');
  assert.equal(scrub('see file%3A%2F%2F%2Fhome%2Fsomeone%2Fx.txt'), 'see [address]');
});

test('the log is a ring of the last 20', async () => {
  let log = [];
  for (let index = 0; index < 30; index++) log = pushRecord(log, makeRecord('background', new Error(`e${index}`), index));
  assert.equal(log.length, MAX_RECORDS);
  assert.equal(log[0].message, 'e10');
  assert.equal(log.at(-1).message, 'e29');

  for (let index = 0; index < 25; index++) recordError('options', new Error(`stored ${index}`));
  await recordError('options', new Error('last'));
  const stored = await getErrorLog();
  assert.equal(stored.length, MAX_RECORDS);
  assert.equal(stored.at(-1).message, 'last');
});

// --- sending ---

const responder = (...statuses) => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const status = statuses[Math.min(calls.length - 1, statuses.length - 1)];
    if (status instanceof Error) throw status;
    return { ok: status >= 200 && status < 300, status, json: async () => (status === 400 ? { error: 'message_too_short' } : { ok: true }) };
  };
  return { calls, fetchImpl };
};
const deps = (net) => ({ endpoint: ENDPOINT, fetchImpl: net.fetchImpl, wait: async () => {} });

test('the body that was previewed is what is posted, as it is, without cookies or referrer', async () => {
  const payload = buildPayload({ draft: draft(), tech: tech() });
  const net = responder(200);
  assert.deepEqual(await sendFeedback(payload, deps(net)), { sent: true });
  assert.equal(net.calls.length, 1);
  assert.equal(net.calls[0].url, ENDPOINT);
  assert.equal(net.calls[0].init.method, 'POST');
  assert.equal(net.calls[0].init.body, JSON.stringify(payload));
  assert.equal(net.calls[0].init.credentials, 'omit');
  assert.equal(net.calls[0].init.referrerPolicy, 'no-referrer');
});

test('nothing is sent without a receiver, a valid body or permission', async () => {
  const payload = buildPayload({ draft: draft() });
  const net = responder(200);
  await assert.rejects(sendFeedback(payload, { ...deps(net), endpoint: '' }), { code: 'feedback_unconfigured' });
  await assert.rejects(sendFeedback({ ...payload, vault: ['book'] }, deps(net)), { code: 'feedback_invalid' });
  granted = false;
  await assert.rejects(sendFeedback(payload, deps(net)), { code: 'feedback_permission' });
  assert.equal(net.calls.length, 0);
});

test('one retry for what may pass by itself, none for a refusal', async () => {
  const payload = buildPayload({ draft: draft() });
  let net = responder(new TypeError('offline'), 200);
  await sendFeedback(payload, deps(net));
  assert.equal(net.calls.length, 2);

  store.clear();
  net = responder(503, 503, 200);
  await assert.rejects(sendFeedback(payload, deps(net)), { code: 'feedback_server' });
  assert.equal(net.calls.length, 2, 'once more, not for ever');
  assert.ok(!store.has('feedbackLastSent'), 'a failure starts no waiting time');

  net = responder(400);
  await assert.rejects(sendFeedback(payload, deps(net)), { code: 'feedback_rejected', detail: 'message_too_short' });
  assert.equal(net.calls.length, 1);
  net = responder(429);
  await assert.rejects(sendFeedback(payload, deps(net)), { code: 'feedback_rate' });
  assert.equal(net.calls.length, 1);
});

test('after sending, the next one has to wait 60 seconds', async () => {
  const payload = buildPayload({ draft: draft() });
  const net = responder(200);
  await sendFeedback(payload, deps(net));
  await assert.rejects(sendFeedback(payload, deps(net)), { code: 'feedback_cooldown' });
  assert.equal(net.calls.length, 1);
  assert.equal(cooldownLeft(1000, 1000 + COOLDOWN_MS), 0);
  assert.equal(cooldownLeft(1000, 31_000), 30_000);
  assert.equal(cooldownLeft(Date.now() + 10 * COOLDOWN_MS), 0, 'a clock that was set back does not lock the form');
});

test('Firefox is told which kinds of data may be sent, as optional', () => {
  const manifest = JSON.parse(readFileSync(new URL('../manifest.firefox.json', import.meta.url), 'utf8'));
  const declared = manifest.browser_specific_settings.gecko.data_collection_permissions;
  assert.deepEqual(declared.optional, ['personalCommunications', 'technicalAndInteraction', 'personallyIdentifyingInfo']);
  assert.ok(!declared.required.some((name) => declared.optional.includes(name)));
});
