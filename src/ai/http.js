// One request to a model, read as it arrives.
//
// Every provider is asked for a streamed answer. Not to show it letter by letter (the whole
// text is handed on at the end), but because of how the browser treats the background script:
// Chrome stops a service worker whose fetch() has not begun to answer after 30 seconds, and a
// streamed answer begins at once while a whole one may take longer than that.

import { WordvaultError } from '../lib/errors.js';

/** The whole request, from sending it to the last piece of the answer. */
export const DEFAULT_TIMEOUT_MS = 90_000;
const MAX_ERROR_BODY = 4000;

/** Keys must never reach an error message, whatever a service chooses to echo back. */
export function hideSecrets(text, secrets = []) {
  let clean = String(text ?? '');
  for (const secret of secrets) if (typeof secret === 'string' && secret.length >= 6) clean = clean.split(secret).join('[key]');
  return clean
    .replace(/\b(sk-ant-|sk-or-|sk-proj-|sk-|gsk_|AIza)[\w-]{6,}/g, '[key]')
    .replace(/\b(Bearer|x-api-key|x-goog-api-key)[\s:=]+\S+/gi, '$1 [key]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

function transportError(error, signal) {
  if (signal?.aborted) return new WordvaultError('aborted', 'the request was given up');
  return new WordvaultError(error?.name === 'TimeoutError' ? 'timeout' : 'network', String(error?.name || 'network error'));
}

/** Splits what has arrived into complete lines; the rest waits for more. */
function takeLines(buffer) {
  const lines = buffer.split(/\r?\n/);
  return { lines: lines.slice(0, -1), rest: lines[lines.length - 1] };
}

/**
 * @param {string} url
 * @param {Object} options
 * @param {Record<string, string>} options.headers
 * @param {object} options.body                 Sent as JSON.
 * @param {(data: any, event: string) => void} options.onData  Called with every JSON object of
 *        the answer: each event of a server-sent stream, each line of a line-delimited one, or
 *        the one object of an answer that was not streamed after all.
 * @param {AbortSignal | null} [options.signal]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{ ok: true } | { ok: false, status: number, data: any, text: string }>}
 *          Not ok: the service refused; `data` is its JSON answer if it was one.
 *          Rejects with WordvaultError 'network', 'timeout' or 'aborted'.
 */
export async function postForStream(url, { headers, body, onData, signal = null, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const either = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: either,
    });
  } catch (error) {
    throw transportError(error, signal);
  }

  try {
    if (!response.ok) {
      const text = (await response.text()).slice(0, MAX_ERROR_BODY);
      let data = null;
      try {
        data = JSON.parse(text);
      } catch {
        // not JSON (a proxy's error page): the status is what there is
      }
      return { ok: false, status: response.status, data, text };
    }

    const type = String(response.headers.get('content-type') || '').toLowerCase();
    const streamed = type.includes('event-stream') || type.includes('ndjson');
    if (!streamed || !response.body) {
      onData(JSON.parse(await response.text()), '');
      return { ok: true };
    }

    const sse = type.includes('event-stream');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let event = '';
    const handle = (line) => {
      if (!sse) {
        if (line.trim()) onData(JSON.parse(line), '');
        return;
      }
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) {
        const payload = line.slice(5).trim();
        if (payload && payload !== '[DONE]') onData(JSON.parse(payload), event);
      } else if (line === '') event = '';
    };
    for (;;) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const { lines, rest } = takeLines(buffer);
      buffer = rest;
      for (const line of lines) handle(line);
      if (done) break;
    }
    if (buffer.trim()) handle(buffer);
    return { ok: true };
  } catch (error) {
    if (error instanceof WordvaultError) throw error;
    if (either.aborted) throw transportError(timeout.aborted && !signal?.aborted ? { name: 'TimeoutError' } : error, signal);
    if (error instanceof SyntaxError) throw new WordvaultError('ai_bad_answer', 'the answer could not be read');
    throw transportError(error, signal);
  }
}
