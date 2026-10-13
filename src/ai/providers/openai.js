// Any service that speaks OpenAI's chat-completions protocol: OpenAI itself, OpenRouter, Groq,
// LM Studio on this computer and others. The user gives the address, the key and the model.
//
// Checked on 2026-10-13 against OpenRouter's reference of the protocol (OpenAI's own reference
// page did not open for an automated reader; the protocol is the same):
//   - POST {base}/chat/completions, `Authorization: Bearer <key>`;
//   - body: `model`, `messages` with the roles `system` and `user`, `stream`;
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

  async generate({ system, prompt }, config, { signal = null, timeoutMs } = {}) {
    const base = parseBase(config.baseUrl);
    if (!base) throw new WordvaultError('ai_address', '');
    let text = '';
    const fail = (status, error) => refusal({ status: Number(error?.code) || status, message: typeof error === 'string' ? error : error?.message || '', kind: `${error?.type || ''} ${error?.code || ''}` }, [config.apiKey]);
    const outcome = await postForStream(`${trimBase(base)}/chat/completions`, {
      headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
      body: { model: config.model, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }], stream: true },
      signal,
      timeoutMs,
      onData: (data) => {
        if (data?.error) throw fail(500, data.error);
        const choice = data?.choices?.[0];
        if (typeof choice?.delta?.content === 'string') text += choice.delta.content;
        else if (typeof choice?.message?.content === 'string') text += choice.message.content;
      },
    });
    if (!outcome.ok) throw fail(outcome.status, outcome.data?.error);
    if (!text.trim()) throw noText();
    return text.trim();
  },
};
