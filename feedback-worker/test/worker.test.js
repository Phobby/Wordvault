// The feedback receiver: what it accepts, what it turns away, what it passes on, and that
// nothing of a secret or of a sender ends up anywhere else.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';

import { buildPayload } from '../../src/features/feedback/payload.js';
import { escapeHtml, escapeMarkdown, formatMessages, istanbulTime } from '../src/format.js';
import worker, { handle } from '../src/index.js';
import { MAX_BYTES, clean, isTrap, validate } from '../src/validate.js';

const NOW = new Date('2026-10-13T11:35:00Z'); // 14:35 in Istanbul
const body = (patch = {}) => ({ v: 1, type: 'bug', feature: 'quiz', message: 'The card is cut off on the left.', ...patch });
const tech = () => ({ browser: 'Zen', browserVersion: '1.16', engine: 'Gecko 143.0', os: 'macOS', extensionVersion: '0.1.0', uiLanguage: 'tr', features: { quiz: true, doubleClick: true, sync: false }, syncMode: 'off' });
const record = (index = 0) => ({ at: NOW.getTime() - index * 60_000, feature: 'sync', message: `TypeError: boom ${index}`, stack: 'run@sync/engine.js:1:1\nnext@sync/engine.js:2:1\nthird@sync/engine.js:3:1' });

const telegram = (...statuses) => {
  const calls = [];
  return {
    calls,
    fetchImpl: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      const status = statuses[Math.min(calls.length - 1, statuses.length - 1)] ?? 200;
      if (status instanceof Error) throw status;
      return new Response('{}', { status });
    },
  };
};
const ENV = { TELEGRAM_BOT_TOKEN: '123:SECRET-TOKEN', TELEGRAM_CHAT_ID: '42' };
const post = (payload, { path = '/feedback', method = 'POST', headers = {} } = {}) =>
  new Request(`https://wordvault-feedback.example.workers.dev${path}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: method === 'GET' ? undefined : typeof payload === 'string' ? payload : JSON.stringify(payload) });
const answer = async (response) => ({ status: response.status, body: await response.json().catch(() => null) });

// --- schema ---

test('what the extension builds is accepted as it is', () => {
  const payload = buildPayload({ draft: { type: 'idea', feature: 'captions', message: '  Please add Netflix.  ', email: 'someone@example.com' }, tech: tech(), errors: [record()] });
  const checked = validate(payload);
  assert.equal(checked.ok, true);
  assert.deepEqual(Object.keys(checked.value), ['type', 'feature', 'message', 'email', 'tech', 'errors']);
  assert.equal(checked.value.message, 'Please add Netflix.');
});

test('fields are checked against the lists and limits', () => {
  const error = (patch) => validate(body(patch)).error;
  assert.equal(validate(body()).ok, true);
  assert.equal(error({ type: 'spam' }), 'bad_type');
  assert.equal(error({ feature: 'everything' }), 'bad_feature');
  assert.equal(error({ message: 'short' }), 'message_too_short');
  assert.equal(error({ message: `${' '.repeat(50)}short\u0000\u0001` }), 'message_too_short', 'spaces and control characters do not count');
  assert.equal(error({ message: 'x'.repeat(1501) }), 'message_too_long');
  assert.equal(validate(body({ message: 'ş'.repeat(1500) })).ok, true);
  assert.equal(error({ message: 12345678901 }), 'bad_shape');
  assert.equal(error({ v: 2 }), 'bad_shape');
  assert.equal(error({ page: 'https://example.com' }), 'bad_shape', 'no fields beyond the list');
  assert.equal(error({ email: 'not an address' }), 'bad_email');
  assert.equal(error({ email: ['a@b.co'] }), 'bad_email');
  assert.equal(validate(body({ email: '' })).value.email, undefined, 'an empty e-mail is no e-mail');
  assert.equal(error({ tech: { ...tech(), installId: 'x' } }), 'bad_tech');
  assert.equal(error({ tech: { ...tech(), features: { quiz: 'yes' } } }), 'bad_tech');
  assert.equal(error({ tech: { ...tech(), browser: 'x'.repeat(61) } }), 'bad_tech');
  assert.equal(error({ errors: Array.from({ length: 21 }, (_, index) => record(index)) }), 'bad_errors');
  assert.equal(error({ errors: [{ ...record(), url: 'https://example.com' }] }), 'bad_errors');
  for (const notAnObject of [null, [], 'text', 5]) assert.equal(validate(notAnObject).error, 'bad_shape');
});

test('control characters are cleaned out', () => {
  assert.equal(clean('a\u0000b\u0007c\u009f'), 'a b c');
  assert.equal(clean('line one\r\nline two\u0000', true), 'line one\nline two');
  assert.equal(validate(body({ message: 'first line\r\nsecond\u0008 line' })).value.message, 'first line\nsecond line');
  assert.equal(validate(body({ tech: { browser: 'Zen\nInjected: line' } })).value.tech.browser, 'Zen Injected: line', 'one-line fields stay one line');
});

// --- escaping and the message ---

test('nothing the sender wrote becomes markup', () => {
  assert.equal(escapeHtml('<b>bold</b> & <a href="tg://user?id=1">me</a>'), '&lt;b&gt;bold&lt;/b&gt; &amp; &lt;a href="tg://user?id=1"&gt;me&lt;/a&gt;');
  assert.equal(escapeMarkdown('@everyone **hi** [x](https://e.com) `c`'), '\\@everyone \\*\\*hi\\*\\* \\[x\\]\\(https\\://e.com\\) \\`c\\`');
  const [text] = formatMessages(validate(body({ message: 'see <script>alert(1)</script> & more', email: 'a<b>@example.com'.replace('<b>', '') })).value, NOW);
  assert.ok(text.includes('see &lt;script&gt;alert(1)&lt;/script&gt; &amp; more'));
  assert.ok(!/<script>/.test(text));
});

test('the message: type, feature, Istanbul time from the receiver, text, e-mail, technical lines', () => {
  assert.equal(istanbulTime(NOW), '13.10.2026 14:35');
  const [text, ...rest] = formatMessages(validate(body({ email: 'someone@example.com', tech: tech() })).value, NOW);
  assert.equal(rest.length, 0);
  assert.equal(
    text,
    ['<b>🐞 Hata</b> · Flash card / quiz', '🕒 13.10.2026 14:35 (İstanbul)', '', 'The card is cut off on the left.', '', '✉️ someone@example.com', '🧩 Zen 1.16 (Gecko 143.0) · macOS · Wordvault 0.1.0 · dil: tr', 'Açık: quiz, doubleClick', 'Kapalı: sync', 'Senkron: off'].join('\n'),
  );
  const plain = formatMessages(validate(body()).value, NOW)[0];
  assert.equal(plain, '<b>🐞 Hata</b> · Flash card / quiz\n🕒 13.10.2026 14:35 (İstanbul)\n\nThe card is cut off on the left.');
});

test('error records go as a second, shortened message', () => {
  const messages = formatMessages(validate(body({ errors: Array.from({ length: 20 }, (_, index) => ({ ...record(19 - index), message: `TypeError: <boom> ${'m'.repeat(180)}`, stack: `${'s'.repeat(100)}\n`.repeat(3) })) })).value, NOW);
  assert.equal(messages.length, 2);
  assert.ok(messages[0].includes('📎 20 hata kaydı sonraki mesajda'));
  assert.ok(messages[1].startsWith('<b>Hata kayıtları</b> (20)\n<pre>'));
  assert.ok(messages.every((text) => text.length <= 4096), 'within what Telegram takes');
  assert.ok(messages[1].includes('&lt;boom&gt;') && !messages[1].includes('<boom>'));
  assert.ok(messages[1].indexOf('13.10.2026 14:35') < messages[1].indexOf('13.10.2026 14:34'), 'newest first');
  const short = formatMessages(validate(body({ errors: [record()] })).value, NOW)[1];
  assert.ok(short.includes('run@sync/engine.js:1:1\nnext@sync/engine.js:2:1') && !short.includes('third@'), 'two stack lines each');
});

test('for Discord the same messages, as Markdown, within its limit', () => {
  const messages = formatMessages(validate(body({ message: `@everyone ${'x'.repeat(1490)}`, tech: tech(), errors: Array.from({ length: 20 }, (_, index) => record(index)) })).value, NOW, 'markdown');
  assert.ok(messages[0].startsWith('**🐞 Hata** · Flash card / quiz'));
  assert.ok(messages[0].includes('\\@everyone'));
  assert.ok(messages.every((text) => text.length <= 2000));
});

// --- the endpoint ---

test('an accepted message is passed on to Telegram, with the receiver\'s time', async () => {
  const net = telegram();
  const sent = body({ tech: tech(), message: 'Sent at <noon> & read later.' });
  const result = await answer(await handle(post(sent, { headers: { 'cf-connecting-ip': '203.0.113.7', origin: 'moz-extension://0f1e2d3c-aaaa-bbbb-cccc-123456789abc' } }), ENV, { fetchImpl: net.fetchImpl, now: () => NOW }));
  assert.deepEqual(result, { status: 200, body: { ok: true } });
  assert.equal(net.calls.length, 1);
  assert.equal(net.calls[0].url, 'https://api.telegram.org/bot123:SECRET-TOKEN/sendMessage');
  assert.equal(net.calls[0].body.chat_id, '42');
  assert.equal(net.calls[0].body.parse_mode, 'HTML');
  assert.ok(net.calls[0].body.text.includes('Sent at &lt;noon&gt; &amp; read later.'));
  assert.ok(net.calls[0].body.text.includes('13.10.2026 14:35'));
  assert.ok(!/203\.0\.113\.7|moz-extension|0f1e2d3c/.test(JSON.stringify(net.calls)), 'neither the address nor the origin is passed on');
});

test('two messages when error records came along', async () => {
  const net = telegram();
  await handle(post(body({ errors: [record(), record(1)] })), ENV, { fetchImpl: net.fetchImpl, now: () => NOW });
  assert.equal(net.calls.length, 2);
  assert.ok(net.calls[1].body.text.startsWith('<b>Hata kayıtları</b> (2)'));
});

test('everything but POST /feedback is 404', async () => {
  const net = telegram();
  for (const request of [post(body(), { path: '/' }), post(body(), { path: '/feedback/' }), post(body(), { path: '/admin' }), post(null, { method: 'GET' }), post(body(), { method: 'PUT' })]) {
    assert.equal((await handle(request, ENV, { fetchImpl: net.fetchImpl })).status, 404);
  }
  assert.equal(net.calls.length, 0);
});

test('a body over 8 KB is turned away, with or without an honest Content-Length', async () => {
  const net = telegram();
  const big = JSON.stringify(body({ message: 'x'.repeat(1400), errors: Array.from({ length: 20 }, () => ({ ...record(), stack: 's'.repeat(320), message: 'm'.repeat(200) })) }));
  assert.ok(big.length > MAX_BYTES);
  assert.deepEqual(await answer(await handle(post(big), ENV, { fetchImpl: net.fetchImpl })), { status: 413, body: { error: 'too_large' } });
  assert.deepEqual(await answer(await handle(post(big, { headers: { 'content-length': '10' } }), ENV, { fetchImpl: net.fetchImpl })), { status: 413, body: { error: 'too_large' } });
  const exact = JSON.stringify(body({ message: 'y'.repeat(1500) }));
  assert.equal((await handle(post(exact), ENV, { fetchImpl: net.fetchImpl })).status, 200);
  assert.equal(net.calls.length, 1);
});

test('bad input gets a code that says what was wrong', async () => {
  const net = telegram();
  assert.deepEqual(await answer(await handle(post('{not json'), ENV, { fetchImpl: net.fetchImpl })), { status: 400, body: { error: 'bad_json' } });
  assert.deepEqual(await answer(await handle(post(body({ message: 'short' })), ENV, { fetchImpl: net.fetchImpl })), { status: 400, body: { error: 'message_too_short' } });
  assert.deepEqual(await answer(await handle(post(body({ type: 'x' })), ENV, { fetchImpl: net.fetchImpl })), { status: 400, body: { error: 'bad_type' } });
  assert.equal(net.calls.length, 0);
});

test('a filled-in hidden field: answered like a success, passed on to nobody', async () => {
  const net = telegram();
  assert.equal(isTrap(body({ website: 'https://spam.example' })), true);
  assert.equal(isTrap(body({ website: '  ' })), false);
  assert.deepEqual(await answer(await handle(post(body({ website: 'https://spam.example' })), ENV, { fetchImpl: net.fetchImpl })), { status: 200, body: { ok: true } });
  assert.deepEqual(await answer(await handle(post({ website: 'x', anything: 'else' }), ENV, { fetchImpl: net.fetchImpl })), { status: 200, body: { ok: true } });
  assert.equal(net.calls.length, 0);
  assert.equal((await handle(post(body({ website: '' })), ENV, { fetchImpl: net.fetchImpl })).status, 200);
  assert.equal(net.calls.length, 1, 'an empty hidden field is a person');
});

test('per sender: over the limit is 429, and the limiter is asked before anything is read', async () => {
  const net = telegram();
  const keys = [];
  const env = { ...ENV, RATE_LIMITER: { limit: async ({ key }) => (keys.push(key), { success: keys.length <= 3 }) } };
  const send = () => handle(post(body(), { headers: { 'cf-connecting-ip': '203.0.113.7' } }), env, { fetchImpl: net.fetchImpl });
  for (let index = 0; index < 3; index++) assert.equal((await send()).status, 200);
  assert.deepEqual(await answer(await send()), { status: 429, body: { error: 'rate_limited' } });
  assert.equal(net.calls.length, 3);
  assert.deepEqual([...new Set(keys)], ['203.0.113.7']);
  env.RATE_LIMITER = { limit: async () => { throw new Error('limiter down'); } };
  assert.equal((await send()).status, 200, 'a broken limiter does not shut the door');
});

test('per day: a ceiling for everybody together, kept as one number', async () => {
  const net = telegram();
  const kv = new Map();
  const env = { ...ENV, DAILY_LIMIT: '2', DAILY: { get: async (key) => kv.get(key) ?? null, put: async (key, value, options) => void kv.set(key, value) || assert.equal(options.expirationTtl, 172_800) } };
  const send = (when = NOW) => handle(post(body()), env, { fetchImpl: net.fetchImpl, now: () => when });
  assert.equal((await send()).status, 200);
  assert.equal((await send()).status, 200);
  assert.deepEqual(await answer(await send()), { status: 429, body: { error: 'daily_limit' } });
  assert.equal(net.calls.length, 2);
  assert.deepEqual([...kv], [['count:2026-10-13', '2']], 'a number per day and nothing else');
  assert.equal((await send(new Date('2026-10-14T00:00:01Z'))).status, 200, 'a new day starts at zero');
  await handle(post(body({ message: 'short' })), env, { fetchImpl: net.fetchImpl, now: () => NOW });
  assert.equal(kv.get('count:2026-10-13'), '2', 'what was turned away does not count');
});

test('Telegram unreachable or refusing: 502, and the token is not in the answer', async () => {
  for (const net of [telegram(new TypeError('fetch failed: https://api.telegram.org/bot123:SECRET-TOKEN/sendMessage')), telegram(401)]) {
    const response = await handle(post(body()), ENV, { fetchImpl: net.fetchImpl });
    const text = await response.text();
    assert.equal(response.status, 502);
    assert.equal(text, '{"error":"delivery_failed"}');
  }
  assert.equal((await handle(post(body()), {}, { fetchImpl: telegram().fetchImpl })).status, 502, 'no secrets set: nothing to pass on to');
});

test('an unexpected failure is a bare 500', async () => {
  const response = await worker.fetch(post(body()), { ...ENV, DAILY: { get: async () => '0', put: async () => {} }, get DAILY_LIMIT() { throw new Error('secret detail'); } });
  assert.equal(response.status, 500);
  assert.equal(await response.text(), '{"error":"internal"}');
});

test('Discord can be chosen instead; nobody can be pinged', async () => {
  const net = telegram();
  const env = { FEEDBACK_CHANNEL: 'discord', DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/1/SECRET' };
  assert.equal((await handle(post(body({ message: '@everyone look at this please' })), env, { fetchImpl: net.fetchImpl, now: () => NOW })).status, 200);
  assert.equal(net.calls[0].url, env.DISCORD_WEBHOOK_URL);
  assert.deepEqual(net.calls[0].body.allowed_mentions, { parse: [] });
  assert.ok(net.calls[0].body.content.includes('\\@everyone'));
  assert.equal((await handle(post(body()), { FEEDBACK_CHANNEL: 'discord', DISCORD_WEBHOOK_URL: 'https://evil.example/hook' }, { fetchImpl: net.fetchImpl })).status, 502);
  assert.equal((await handle(post(body()), { ...ENV, FEEDBACK_CHANNEL: 'pigeon' }, { fetchImpl: net.fetchImpl })).status, 502);
  assert.equal(net.calls.length, 1);
});

// --- what the code may not do ---

test('the Worker logs nothing, stores no message and holds no secret', () => {
  const dir = new URL('../src/', import.meta.url);
  const source = readdirSync(dir).map((name) => readFileSync(new URL(name, dir), 'utf8')).join('\n');
  assert.ok(!/console\./.test(source), 'no console call');
  assert.ok(!/headers\.get\(['"](?:origin|referer|user-agent|x-forwarded-for)/i.test(source), 'origin, referrer and user agent are not read');
  assert.equal(source.match(/cf-connecting-ip/g).length, 1, 'the address is read in one place, for the limiter');
  assert.equal(source.match(/\.put\(/g).length, 1, 'one write: the day\'s counter');
  const config = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
  assert.ok(!/TELEGRAM_BOT_TOKEN\s*=|TELEGRAM_CHAT_ID\s*=|DISCORD_WEBHOOK_URL\s*=/.test(config), 'secrets are not in wrangler.toml');
  assert.ok(!/\d{8,10}:[\w-]{30,}/.test(config + source), 'nothing that looks like a bot token');
  assert.match(config, /\[observability\]\s*\nenabled = false/);
});
