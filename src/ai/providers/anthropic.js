// The Claude API (Anthropic), with the user's own key from the Claude Console.
//
// Checked against Anthropic's documentation on 2026-10-13 (platform.claude.com/docs: API
// overview, Messages, Streaming, Errors, Models overview):
//   - POST https://api.anthropic.com/v1/messages
//   - headers: `x-api-key`, `anthropic-version: 2023-06-01`, `content-type: application/json`;
//   - body: `model`, `max_tokens`, `system` (top level), `messages`, `stream`;
//   - a picture is a content block before the text: `{ type: 'image', source: { type: 'base64',
//     media_type, data } }` (Vision);
//   - streamed text arrives as `content_block_delta` events with a `text_delta`; an `error`
//     event can come in the middle of a stream;
//   - errors: `{ type: 'error', error: { type, message } }`: 401 authentication_error,
//     403 permission_error, 404 not_found_error, 429 rate_limit_error, 529 overloaded_error.
//
// ASSUMPTION: `anthropic-dangerous-direct-browser-access` is sent because the request comes
// from a browser and carries an Origin; the pages above do not mention the header (the SDK's
// browser option sets it). The name is alarming on purpose: it is for exactly this case, a key
// that is the user's own and stays in the user's browser.

import { postForStream } from '../http.js';
import { noText, refusal } from './shared.js';

const BASE = 'https://api.anthropic.com';

export const anthropic = {
  id: 'anthropic',
  name: 'Claude (Anthropic)',
  needsKey: true,
  needsBase: false,
  // "Fastest" in Anthropic's model table; plenty for a short explanation.
  defaultModel: 'claude-haiku-5-5',
  defaultBase: '',
  keyPage: 'https://platform.claude.com/settings/keys',
  origins: () => [`${BASE}/*`],

  async generate({ system, prompt, maxTokens, image = null }, config, { signal = null, timeoutMs } = {}) {
    const content = image ? [{ type: 'image', source: { type: 'base64', media_type: image.mime, data: image.data } }, { type: 'text', text: prompt }] : prompt;
    let text = '';
    const fail = (status, error) => refusal({ status, message: error?.message || '', kind: error?.type || '' }, [config.apiKey]);
    const outcome = await postForStream(`${BASE}/v1/messages`, {
      headers: { 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: { model: config.model, max_tokens: maxTokens, system, messages: [{ role: 'user', content }], stream: true },
      signal,
      timeoutMs,
      onData: (data) => {
        if (data?.type === 'error') throw fail(data.error?.type === 'overloaded_error' ? 529 : data.error?.type === 'rate_limit_error' ? 429 : 500, data.error);
        if (data?.type === 'content_block_delta' && data.delta?.type === 'text_delta') text += data.delta.text;
        // not streamed after all: the whole message at once
        if (data?.type === 'message') for (const block of data.content || []) if (block.type === 'text') text += block.text;
      },
    });
    if (!outcome.ok) throw fail(outcome.status, outcome.data?.error);
    if (!text.trim()) throw noText();
    return text.trim();
  },
};
