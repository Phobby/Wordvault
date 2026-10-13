// Ollama: models that run on the user's own computer. Nothing leaves it.
//
// Checked against Ollama's documentation on 2026-10-13 (docs.ollama.com: /api/chat, /api/errors,
// FAQ):
//   - "Ollama binds 127.0.0.1 port 11434 by default";
//   - POST {base}/api/chat with `model`, `messages` (roles system, user), `stream`;
//   - a streamed answer is `application/x-ndjson`: one JSON object per line, each with a piece
//     of `message.content`, the last with `done: true`; an error in the middle of a stream is a
//     line with an `error` property;
//   - errors: `{ "error": "..." }`, 404 when the model does not exist;
//   - Ollama only accepts requests from origins it knows. A browser extension has to be
//     allowed with the OLLAMA_ORIGINS variable (the FAQ's example:
//     `OLLAMA_ORIGINS=chrome-extension://*,moz-extension://*,safari-web-extension://*`).
//     Without it the request is turned away with 403.

import { postForStream } from '../http.js';
import { noText, originPattern, parseBase, refusal, trimBase } from './shared.js';
import { WordvaultError } from '../../lib/errors.js';

export const ollama = {
  id: 'ollama',
  name: 'Ollama',
  needsKey: false,
  needsBase: true,
  defaultModel: '', // whichever model the user has pulled
  defaultBase: 'http://localhost:11434',
  keyPage: '',
  /** Models run slowly on an ordinary computer, and the first answer waits for the model to load. */
  timeoutMs: 180_000,
  /**
   * A long page is sent in parts of this many characters (ai/summary.js). Checked against
   * docs.ollama.com/context-length on 2026-10-14: with less than 24 GiB of video memory the
   * context is 4k tokens by default, and the page does not say what happens to a longer
   * prompt. ASSUMPTION: about 2,000 tokens of text per part leave room for the instructions
   * and the answer within that.
   */
  partChars: 8_000,
  /** ... and a page that is translated in chunks of this many (ai/page-translate.js): question and answer both have to fit. */
  pageChunkChars: 1_500,
  origins: (config) => {
    const url = parseBase(config.baseUrl);
    return url ? [originPattern(url)] : [];
  },

  async generate({ system, prompt }, config, { signal = null, timeoutMs } = {}) {
    const base = parseBase(config.baseUrl);
    if (!base) throw new WordvaultError('ai_address', '');
    let text = '';
    const outcome = await postForStream(`${trimBase(base)}/api/chat`, {
      headers: {},
      body: { model: config.model, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }], stream: true },
      signal,
      timeoutMs: timeoutMs || ollama.timeoutMs,
      onData: (data) => {
        if (data?.error) throw refusal({ status: 500, message: String(data.error) });
        if (typeof data?.message?.content === 'string') text += data.message.content;
      },
    });
    if (!outcome.ok) {
      // Turned away before anything was looked at: this extension's origin is not on Ollama's list.
      if (outcome.status === 403) throw new WordvaultError('ai_origin', '');
      throw refusal({ status: outcome.status, message: typeof outcome.data?.error === 'string' ? outcome.data.error : '' });
    }
    if (!text.trim()) throw noText();
    return text.trim();
  },
};
