// Any service that speaks OpenAI's chat-completions protocol: OpenAI itself, OpenRouter, Groq,
// LM Studio on this computer and others. The user gives the address, the key and the model.
//
// Checked on 2026-10-13 against OpenRouter's reference of the protocol (OpenAI's own reference
// page did not open for an automated reader; the protocol is the same):
//   - POST {base}/chat/completions, `Authorization: Bearer <key>`;
//   - body: `model`, `messages` with the roles `system` and `user`, `stream`;
//   - a picture: the user message's `content` is a list, the text and
//     `{ type: 'image_url', image_url: { url: 'data:<type>;base64,<data>' } }`. Services and
//     models that read no pictures refuse it or ignore it (ai/vision.js finds out which);
//   - the text is in `choices[].message.content`, streamed in `choices[].delta.content`,
//     and a stream ends with `data: [DONE]`;
//   - errors: `{ error: { code, message } }`: 401, 402 (no credit), 404, 429.
//
// No limit on the length of the answer is sent: `max_tokens` is deprecated in favour of
// `max_completion_tokens`, and which of the two a given service accepts differs. The prompt
// asks for a short answer instead.

import { postForStream } from '../http.js';
import { noText, originPattern, parseBase, refusal, trimBase } from './shared.js';
import { WordvaultError } from '../../lib/errors.js';

/**
 * JSON output (Chat Completions `response_format`, checked 2026-10-17): a schema with strict
 * adherence, or the older JSON mode, which wants the word "JSON" somewhere in the messages.
 */
function responseFormat(json) {
  if (!json) return {};
  if (json.mode === 'schema') return { response_format: { type: 'json_schema', json_schema: { name: json.name, strict: true, schema: json.schema } } };
  return { response_format: { type: 'json_object' } };
}

/**
 * One answer from a chat-completions endpoint under `base` (a URL). Shared with the providers
 * that speak the same protocol at a fixed address (nvidia.js). `extra` is added to the request
 * body (fields only that service understands).
 */
export async function chatCompletions(base, { system, prompt, image = null, json = null, temperature }, config, { signal = null, timeoutMs } = {}, extra = {}) {
  let text = '';
  const content = image ? [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: `data:${image.mime};base64,${image.data}` } }] : prompt;
  const fail = (status, error) => refusal({ status: Number(error?.code) || status, message: typeof error === 'string' ? error : error?.message || '', kind: `${error?.type || ''} ${error?.code || ''}` }, [config.apiKey]);
  const outcome = await postForStream(`${trimBase(base)}/chat/completions`, {
    headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
    body: { model: config.model, messages: [{ role: 'system', content: system }, { role: 'user', content }], stream: true, ...(temperature === undefined ? {} : { temperature }), ...responseFormat(json), ...extra },
    signal,
    timeoutMs,
    onData: (data) => {
      if (data?.error) throw fail(500, data.error);
      const choice = data?.choices?.[0];
      if (typeof choice?.delta?.content === 'string') text += choice.delta.content;
      else if (typeof choice?.message?.content === 'string') text += choice.message.content;
    },
  });
  // Some services answer a refusal in the form of RFC 9457 instead: { status, title, detail }.
  if (!outcome.ok) throw fail(outcome.status, outcome.data?.error || (outcome.data?.detail || outcome.data?.title ? { message: outcome.data.detail || outcome.data.title } : undefined));
  if (!text.trim()) throw noText();
  return text.trim();
}

export const openai = {
  id: 'openai',
  name: 'OpenAI-compatible',
  needsKey: false, // a server on this computer usually wants none
  needsBase: true,
  defaultModel: '', // differs per service: the user types it
  defaultBase: 'https://api.openai.com/v1',
  keyPage: '',
  origins: (config) => {
    const url = parseBase(config.baseUrl);
    return url ? [originPattern(url)] : [];
  },

  async generate(request, config, options) {
    const base = parseBase(config.baseUrl);
    if (!base) throw new WordvaultError('ai_address', '');
    return chatCompletions(base, request, config, options);
  },
};
