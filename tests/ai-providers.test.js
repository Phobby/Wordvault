// The AI providers, against a stand-in server: what is sent where (and that a key only ever
// travels in a header), how streamed and whole answers are read, how refusals become our
// error codes, giving a request up, and that no error message carries a key.

import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import { hideSecrets } from '../src/ai/http.js';
import { getAiProvider, listAiProviders } from '../src/ai/providers/index.js';
import { parseBase } from '../src/ai/providers/shared.js';

const KEY = 'sk-test-SECRET-0123456789abcdef';
const encoder = new TextEncoder();
const realFetch = globalThis.fetch;
let calls;
let reply;

/** An answer that arrives in pieces, cut wherever `chunks` says (also in the middle of a line). */
const streamed = (chunks, type) =>
  new Response(new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(encoder.encode(chunk)); controller.close(); } }), { status: 200, headers: { 'content-type': type } });
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const request = { system: 'RULES', prompt: 'QUESTION', maxTokens: 4096 };

beforeEach(() => {
  calls = [];
  reply = () => json(500, {});
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body), init });
    return reply(init);
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

test('the four providers are there, each with what the settings page needs', () => {
  assert.deepEqual(listAiProviders().map((provider) => provider.id), ['gemini', 'anthropic', 'openai', 'ollama']);
  for (const provider of listAiProviders()) {
    assert.equal(typeof provider.generate, 'function');
    assert.equal(typeof provider.origins, 'function');
    assert.equal(typeof provider.defaultModel, 'string');
  }
  assert.deepEqual(getAiProvider('gemini').origins({}), ['https://generativelanguage.googleapis.com/*']);
  assert.deepEqual(getAiProvider('anthropic').origins({}), ['https://api.anthropic.com/*']);
  assert.deepEqual(getAiProvider('ollama').origins({ baseUrl: 'http://localhost:11434' }), ['http://localhost/*']);
  assert.deepEqual(getAiProvider('openai').origins({ baseUrl: 'https://openrouter.ai/api/v1' }), ['https://openrouter.ai/*']);
  assert.equal(getAiProvider('nothing'), null);
});

test('Gemini: the key in a header and not in the address, streamed text put together', async () => {
  reply = () => streamed(['data: {"candidates":[{"content":{"parts":[{"text":"Mer"}]}}]}\n\nda', 'ta: {"candidates":[{"content":{"parts":[{"text":"haba"},{"text":"(thinking)","thought":true}]}}]}\n\n'], 'text/event-stream');
  const text = await getAiProvider('gemini').generate(request, { apiKey: KEY, model: 'gemini-3.5-flash-lite' });
  assert.equal(text, 'Merhaba');
  const [call] = calls;
  assert.equal(call.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:streamGenerateContent?alt=sse');
  assert.equal(call.headers['x-goog-api-key'], KEY);
  assert.ok(!call.url.includes(KEY));
  assert.deepEqual(call.body.systemInstruction, { parts: [{ text: 'RULES' }] });
  assert.deepEqual(call.body.contents, [{ role: 'user', parts: [{ text: 'QUESTION' }] }]);
  assert.equal(call.body.generationConfig.maxOutputTokens, 4096);
  assert.equal(call.init.credentials, 'omit');
});

test('Gemini: refusals', async () => {
  const gemini = getAiProvider('gemini');
  const config = { apiKey: KEY, model: 'x' };
  reply = () => json(400, { error: { code: 400, message: `API key not valid. Please pass a valid API key. (${KEY})`, status: 'INVALID_ARGUMENT' } });
  await assert.rejects(gemini.generate(request, config), (error) => error.code === 'ai_auth' && !error.detail.includes(KEY));
  reply = () => json(404, { error: { code: 404, message: 'models/x is not found', status: 'NOT_FOUND' } });
  await assert.rejects(gemini.generate(request, config), (error) => error.code === 'ai_model');
  reply = () => json(429, { error: { code: 429, message: 'Quota exceeded', status: 'RESOURCE_EXHAUSTED' } });
  await assert.rejects(gemini.generate(request, config), (error) => error.code === 'ai_quota');
  reply = () => json(503, { error: { code: 503, message: 'overloaded', status: 'UNAVAILABLE' } });
  await assert.rejects(gemini.generate(request, config), (error) => error.code === 'ai_overloaded' && error.detail === 'overloaded');
  reply = () => streamed(['data: {"promptFeedback":{"blockReason":"SAFETY"}}\n\n'], 'text/event-stream');
  await assert.rejects(gemini.generate(request, config), (error) => error.code === 'ai_refused');
});

test('Claude: headers, the system prompt at the top level, text deltas only', async () => {
  reply = () =>
    streamed(
      [
        'event: message_start\ndata: {"type":"message_start"}\n\nevent: ping\ndata: {"type":"ping"}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"hmm"}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Bir "}}\n\nevent: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"isim."}}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
      ],
      'text/event-stream',
    );
  const text = await getAiProvider('anthropic').generate(request, { apiKey: KEY, model: 'claude-haiku-5-5' });
  assert.equal(text, 'Bir isim.');
  const [call] = calls;
  assert.equal(call.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(call.headers['x-api-key'], KEY);
  assert.equal(call.headers['anthropic-version'], '2023-06-01');
  assert.deepEqual(call.body, { model: 'claude-haiku-5-5', max_tokens: 4096, system: 'RULES', messages: [{ role: 'user', content: 'QUESTION' }], stream: true });
});

test('Claude: refusals, also in the middle of a stream', async () => {
  const claude = getAiProvider('anthropic');
  const config = { apiKey: KEY, model: 'x' };
  reply = () => json(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } });
  await assert.rejects(claude.generate(request, config), (error) => error.code === 'ai_auth');
  reply = () => json(404, { type: 'error', error: { type: 'not_found_error', message: 'model: x' } });
  await assert.rejects(claude.generate(request, config), (error) => error.code === 'ai_model');
  reply = () => json(429, { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } });
  await assert.rejects(claude.generate(request, config), (error) => error.code === 'ai_quota');
  reply = () => json(400, { type: 'error', error: { type: 'invalid_request_error', message: 'max_tokens: too large' } });
  await assert.rejects(claude.generate(request, config), (error) => error.code === 'ai_request' && /max_tokens/.test(error.detail));
  reply = () => streamed(['event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n'], 'text/event-stream');
  await assert.rejects(claude.generate(request, config), (error) => error.code === 'ai_overloaded');
});

test('OpenAI-compatible: the address the user gave, a bearer key, a stream that ends with [DONE]', async () => {
  reply = () => streamed(['data: {"choices":[{"delta":{"role":"assistant"}}]}\n\ndata: {"choices":[{"delta":{"content":"Selam"}}]}\n\n', 'data: {"choices":[{"delta":{"content":"!"}}]}\n\ndata: [DONE]\n\n'], 'text/event-stream; charset=utf-8');
  const openai = getAiProvider('openai');
  assert.equal(await openai.generate(request, { apiKey: KEY, model: 'some/model', baseUrl: 'https://openrouter.ai/api/v1/' }), 'Selam!');
  assert.equal(calls[0].url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(calls[0].headers.Authorization, `Bearer ${KEY}`);
  assert.deepEqual(calls[0].body, { model: 'some/model', messages: [{ role: 'system', content: 'RULES' }, { role: 'user', content: 'QUESTION' }], stream: true });
  // a server that does not stream, and wants no key
  reply = () => json(200, { choices: [{ message: { role: 'assistant', content: ' Tamam. ' } }] });
  assert.equal(await openai.generate(request, { apiKey: '', model: 'local', baseUrl: 'http://localhost:1234/v1' }), 'Tamam.');
  assert.equal(calls[1].url, 'http://localhost:1234/v1/chat/completions');
  assert.equal('Authorization' in calls[1].headers, false);
});

test('OpenAI-compatible: refusals; a key echoed back is never passed on', async () => {
  const openai = getAiProvider('openai');
  const config = { apiKey: KEY, model: 'm', baseUrl: 'https://api.openai.com/v1' };
  reply = () => json(401, { error: { message: `Incorrect API key provided: ${KEY}. You can find your API key at ...`, type: 'invalid_request_error', code: 'invalid_api_key' } });
  await assert.rejects(openai.generate(request, config), (error) => error.code === 'ai_auth' && !error.detail.includes(KEY) && !/SECRET/.test(error.detail));
  reply = () => json(402, { error: { code: 402, message: 'Insufficient credits' } });
  await assert.rejects(openai.generate(request, config), (error) => error.code === 'ai_quota');
  reply = () => json(404, { error: { message: 'The model `m` does not exist', code: 'model_not_found' } });
  await assert.rejects(openai.generate(request, config), (error) => error.code === 'ai_model');
  reply = () => new Response('<html>Bad gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } });
  await assert.rejects(openai.generate(request, config), (error) => error.code === 'ai_overloaded');
  await assert.rejects(openai.generate(request, { ...config, baseUrl: 'http://192.168.1.5:1234/v1' }), (error) => error.code === 'ai_address');
  await assert.rejects(openai.generate(request, { ...config, baseUrl: 'not an address' }), (error) => error.code === 'ai_address');
});

test('Ollama: lines of JSON, no key, and what it says when it turns the extension away', async () => {
  reply = () => streamed(['{"message":{"role":"assistant","content":"Bu "},"done":false}\n{"message":{"role":"assis', 'tant","content":"bir kelime."},"done":false}\n{"message":{"content":""},"done":true}\n'], 'application/x-ndjson');
  const ollama = getAiProvider('ollama');
  const config = { apiKey: '', model: 'gemma4', baseUrl: 'http://localhost:11434' };
  assert.equal(await ollama.generate(request, config), 'Bu bir kelime.');
  assert.equal(calls[0].url, 'http://localhost:11434/api/chat');
  assert.deepEqual(Object.keys(calls[0].headers), ['Content-Type']);
  assert.deepEqual(calls[0].body, { model: 'gemma4', messages: [{ role: 'system', content: 'RULES' }, { role: 'user', content: 'QUESTION' }], stream: true });
  reply = () => new Response('', { status: 403 });
  await assert.rejects(ollama.generate(request, config), (error) => error.code === 'ai_origin');
  reply = () => json(404, { error: "model 'gemma4' not found" });
  await assert.rejects(ollama.generate(request, config), (error) => error.code === 'ai_model');
  reply = () => streamed(['{"message":{"content":"Bu "},"done":false}\n{"error":"an error was encountered while running the model"}\n'], 'application/x-ndjson');
  await assert.rejects(ollama.generate(request, config), (error) => error.code === 'ai_overloaded');
  // not running at all
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(ollama.generate(request, config), (error) => error.code === 'network');
});

test('a request can be given up, and one that takes too long ends by itself', async () => {
  globalThis.fetch = (url, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('gone'), { name: init.signal.reason?.name || 'AbortError' }))));
  const controller = new AbortController();
  const waiting = getAiProvider('gemini').generate(request, { apiKey: KEY, model: 'm' }, { signal: controller.signal });
  controller.abort();
  await assert.rejects(waiting, (error) => error.code === 'aborted');
  // (the timer behind a time limit does not keep Node running by itself: this one does)
  const hold = setTimeout(() => {}, 2000);
  await assert.rejects(getAiProvider('gemini').generate(request, { apiKey: KEY, model: 'm' }, { timeoutMs: 20 }), (error) => error.code === 'timeout');
  clearTimeout(hold);
});

test('an answer without text is said to be one', async () => {
  reply = () => streamed(['data: {"choices":[{"delta":{"content":"  "}}]}\n\ndata: [DONE]\n\n'], 'text/event-stream');
  await assert.rejects(getAiProvider('openai').generate(request, { apiKey: '', model: 'm', baseUrl: 'https://api.openai.com/v1' }), (error) => error.code === 'ai_empty');
});

test('keys are taken out of whatever a service says', () => {
  assert.equal(hideSecrets(`bad key ${KEY} here`, [KEY]), 'bad key [key] here');
  for (const sample of ['sk-ant-api03-abcdefghij', 'AIzaSyA-abcdefghijklmnop', 'gsk_abcdefghijklmnop', 'sk-or-v1-abcdefghijkl', 'Bearer abc.def.ghi']) {
    assert.ok(!hideSecrets(`x ${sample} y`).includes(sample.replace('Bearer ', '')), sample);
  }
  assert.ok(hideSecrets('a'.repeat(1000)).length <= 300);
});

test('an address has to be https, or this computer', () => {
  assert.ok(parseBase('https://api.groq.com/openai/v1'));
  assert.ok(parseBase('http://localhost:11434'));
  assert.ok(parseBase('http://127.0.0.1:1234/v1'));
  assert.equal(parseBase('http://example.com/v1'), null);
  assert.equal(parseBase('ftp://example.com'), null);
  assert.equal(parseBase('https://user:pass@example.com'), null);
  assert.equal(parseBase(''), null);
});
