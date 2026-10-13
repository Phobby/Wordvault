// Sending feedback. Runs in the background script, like every other request the extension
// makes. Nothing is sent from here unless the options page asks for it, which it only does
// when the user has seen the exact data and pressed "Send".

import { feedbackEndpoint } from '../../config.js';
import { WordvaultError } from '../../lib/errors.js';
import { checkPayload } from './payload.js';

const LAST_SENT_KEY = 'feedbackLastSent';
export const COOLDOWN_MS = 60_000;
const TIMEOUT_MS = 12_000;
const RETRY_AFTER_MS = 1500;

/** The permission pattern for the receiver's host: that host and no other. */
export function endpointOrigin(endpoint = feedbackEndpoint()) {
  if (!endpoint) return '';
  const url = new URL(endpoint);
  return `${url.protocol}//${url.hostname}/*`;
}

/** @returns {number} Milliseconds until feedback may be sent again (0: now). */
export function cooldownLeft(lastSent, now = Date.now()) {
  const left = Number(lastSent || 0) + COOLDOWN_MS - now;
  return left > 0 && left <= COOLDOWN_MS ? left : 0;
}

export async function getCooldown() {
  return cooldownLeft((await chrome.storage.local.get(LAST_SENT_KEY))[LAST_SENT_KEY]);
}

async function post(endpoint, body, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new WordvaultError(error?.name === 'TimeoutError' ? 'timeout' : 'network', String(error?.message || ''));
  }
  if (response.ok) return;
  if (response.status === 429) throw new WordvaultError('feedback_rate', 'the receiver asks to wait');
  // The receiver names what it did not accept ({ "error": "message_too_long" }).
  const reason = await response.json().then((data) => String(data?.error || '').replace(/[^\w-]/g, '').slice(0, 40), () => '');
  throw new WordvaultError(response.status >= 500 ? 'feedback_server' : 'feedback_rejected', reason || String(response.status));
}

/**
 * @param {Object} payload  What the user saw in the preview (payload.js: buildPayload).
 * @param {{ endpoint?: string, fetchImpl?: typeof fetch, wait?: (ms: number) => Promise<void> }} [deps]  For tests.
 */
export async function sendFeedback(payload, { endpoint = feedbackEndpoint(), fetchImpl = fetch, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  if (!endpoint) throw new WordvaultError('feedback_unconfigured');
  const problem = checkPayload(payload);
  if (problem) throw new WordvaultError('feedback_invalid', problem);
  const left = await getCooldown();
  if (left > 0) throw new WordvaultError('feedback_cooldown', String(Math.ceil(left / 1000)));
  if (!(await chrome.permissions.contains({ origins: [endpointOrigin(endpoint)] }))) throw new WordvaultError('feedback_permission');

  const body = JSON.stringify(payload);
  try {
    await post(endpoint, body, fetchImpl);
  } catch (error) {
    // Once more for what may pass by itself; not for what the receiver refused.
    if (!['network', 'timeout', 'feedback_server'].includes(error.code)) throw error;
    await wait(RETRY_AFTER_MS);
    await post(endpoint, body, fetchImpl);
  }
  await chrome.storage.local.set({ [LAST_SENT_KEY]: Date.now() });
  return { sent: true };
}
