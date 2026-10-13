// Wordvault's feedback receiver: a Cloudflare Worker with one address, POST /feedback.
// It checks what arrives, passes it on to the developer (Telegram or Discord) and forgets it.
//
// Nothing is stored and nothing is written to a log: there is no console call in this Worker,
// and the address the request came from is used for one thing only, the rate limit, where it
// is handed to Cloudflare's limiter and not kept here. The request's Origin header (which in
// Firefox identifies an installation) is never read.

import { DeliveryError, deliver } from './senders.js';
import { MAX_BYTES, isTrap, validate } from './validate.js';

const DEFAULT_DAILY_LIMIT = 200;

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
const notFound = () => new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });

/** The body as text, or null when it is larger than allowed. Reading stops at the limit. */
async function readBody(request) {
  if (Number(request.headers.get('content-length') || 0) > MAX_BYTES) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

const dayKey = (now) => `count:${now.toISOString().slice(0, 10)}`;

/**
 * The ceiling for a whole day, however many addresses the messages come from. What is kept is
 * one number per day and nothing about any message or sender. Without the DAILY binding
 * there is no ceiling.
 */
async function dailyCount(env, now) {
  if (!env.DAILY) return 0;
  return Number(await env.DAILY.get(dayKey(now)).catch(() => 0)) || 0;
}

/**
 * @param {Request} request
 * @param {Object} env  Bindings and secrets (see wrangler.toml and the README).
 * @param {{ fetchImpl?: typeof fetch, now?: () => Date }} [deps]  For tests.
 */
export async function handle(request, env, { fetchImpl = fetch, now = () => new Date() } = {}) {
  const url = new URL(request.url);
  if (url.pathname !== '/feedback' || request.method !== 'POST') return notFound();

  // Per sender: a few messages a minute. The address goes to Cloudflare's limiter and nowhere else.
  if (env.RATE_LIMITER) {
    const address = request.headers.get('cf-connecting-ip') || 'unknown';
    const { success } = await env.RATE_LIMITER.limit({ key: address }).catch(() => ({ success: true }));
    if (!success) return json(429, { error: 'rate_limited' });
  }

  const text = await readBody(request);
  if (text === null) return json(413, { error: 'too_large' });
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return json(400, { error: 'bad_json' });
  }
  // Answered like a success, passed on to nobody.
  if (isTrap(body)) return json(200, { ok: true });
  const checked = validate(body);
  if (!checked.ok) return json(400, { error: checked.error });

  const time = now();
  const limit = Number(env.DAILY_LIMIT) > 0 ? Number(env.DAILY_LIMIT) : DEFAULT_DAILY_LIMIT;
  const count = await dailyCount(env, time);
  if (count >= limit) return json(429, { error: 'daily_limit' });

  try {
    await deliver(checked.value, env, time, fetchImpl);
  } catch (error) {
    if (!(error instanceof DeliveryError)) throw error;
    return json(502, { error: 'delivery_failed' });
  }
  if (env.DAILY) await env.DAILY.put(dayKey(time), String(count + 1), { expirationTtl: 2 * 24 * 60 * 60 }).catch(() => {});
  return json(200, { ok: true });
}

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch {
      // Whatever went wrong, its description stays here: it could contain what was sent.
      return json(500, { error: 'internal' });
    }
  },
};
