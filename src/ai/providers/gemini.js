// Google Gemini, with an API key from Google AI Studio.
//
// Checked against Google's documentation on 2026-10-13 (ai.google.dev/api/generate-content,
// /gemini-api/docs/api-key, /docs/models, /docs/api-errors):
//   - POST https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent?alt=sse
//   - the key travels in the header `x-goog-api-key`, never in the address;
//   - body: `systemInstruction`, `contents[].parts[].text`, `generationConfig.maxOutputTokens`;
//   - a picture goes along as a part of its own: `{ inlineData: { mimeType, data } }`, data in
//     base64 (ai.google.dev/gemini-api/docs/image-understanding);
//   - the answer's text is in `candidates[].content.parts[].text`, one piece per event;
//   - errors: `{ error: { code, message, status } }`; 429 when a limit or the quota is reached,
//     404 for an unknown model, 400/401/403 for a key that is not valid.

import { postForStream } from '../http.js';
import { noText, refusal } from './shared.js';
import { WordvaultError } from '../../lib/errors.js';

const BASE = 'https://generativelanguage.googleapis.com';

/**
 * JSON output (ai.google.dev/api/generate-content, GenerationConfig, checked 2026-10-17):
 * `responseFormat.text` with a schema is the current form (`responseSchema` and
 * `_responseJsonSchema` are deprecated); without a schema, `responseMimeType` alone.
 */
function geminiFormat(json) {
  if (!json) return {};
  if (json.mode === 'schema') return { responseFormat: { text: { mimeType: 'APPLICATION_JSON', schema: json.schema } } };
  return { responseMimeType: 'application/json' };
}

export const gemini = {
  id: 'gemini',
  name: 'Google Gemini',
  needsKey: true,
  needsBase: false,
  // "Recommended fast, low-cost general model" on Google's models page; it has a free tier.
  defaultModel: 'gemini-3.5-flash-lite',
  defaultBase: '',
  keyPage: 'https://aistudio.google.com/apikey',
  origins: () => [`${BASE}/*`],

  async generate({ system, prompt, maxTokens, image = null, json = null, temperature }, config, { signal = null, timeoutMs } = {}) {
    let text = '';
    let blocked = '';
    const parts = image ? [{ inlineData: { mimeType: image.mime, data: image.data } }, { text: prompt }] : [{ text: prompt }];
    const outcome = await postForStream(`${BASE}/v1beta/models/${encodeURIComponent(config.model)}:streamGenerateContent?alt=sse`, {
      headers: { 'x-goog-api-key': config.apiKey },
      body: {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts }],
        generationConfig: { maxOutputTokens: maxTokens, ...(temperature === undefined ? {} : { temperature }), ...geminiFormat(json) },
      },
      signal,
      timeoutMs,
      onData: (data) => {
        if (data?.error) throw refusal({ status: Number(data.error.code) || 500, message: data.error.message, kind: data.error.status }, [config.apiKey]);
        if (data?.promptFeedback?.blockReason) blocked = String(data.promptFeedback.blockReason);
        for (const part of data?.candidates?.[0]?.content?.parts || []) if (typeof part.text === 'string' && part.thought !== true) text += part.text;
      },
    });
    if (!outcome.ok) throw refusal({ status: outcome.status, message: outcome.data?.error?.message || '', kind: outcome.data?.error?.status || outcome.data?.error?.code || '' }, [config.apiKey]);
    if (!text.trim()) throw blocked ? new WordvaultError('ai_refused', blocked) : noText();
    return text.trim();
  },
};
