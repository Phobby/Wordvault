// Where an accepted message is passed on to. Which one is used is chosen by the environment
// variable FEEDBACK_CHANNEL ('telegram', the default, or 'discord'). The secrets live in the
// Worker's secrets and nowhere else.

import { formatMessages } from './format.js';

/** Thrown when the message could not be passed on. Carries no detail: details would hold secrets. */
export class DeliveryError extends Error {}

async function post(fetchImpl, url, body) {
  let response;
  try {
    response = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new DeliveryError('unreachable');
  }
  if (!response.ok) throw new DeliveryError(`status ${response.status}`);
}

const senders = {
  /** Telegram Bot API, sendMessage, HTML mode. Needs TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID. */
  async telegram(feedback, env, now, fetchImpl) {
    if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) throw new DeliveryError('not configured');
    for (const text of formatMessages(feedback, now, 'html')) {
      await post(fetchImpl, `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        chat_id: env.TELEGRAM_CHAT_ID,
        text,
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
      });
    }
  },
  /** A Discord webhook. Needs DISCORD_WEBHOOK_URL. Nobody can be pinged from a message. */
  async discord(feedback, env, now, fetchImpl) {
    if (!/^https:\/\/(?:\w+\.)?discord(?:app)?\.com\/api\/webhooks\//.test(env.DISCORD_WEBHOOK_URL || '')) throw new DeliveryError('not configured');
    for (const content of formatMessages(feedback, now, 'markdown')) {
      await post(fetchImpl, env.DISCORD_WEBHOOK_URL, { content, allowed_mentions: { parse: [] }, flags: 4 /* no link previews */ });
    }
  },
};

/** @returns {Promise<void>} Rejects with DeliveryError. */
export function deliver(feedback, env, now, fetchImpl) {
  const send = senders[String(env.FEEDBACK_CHANNEL || 'telegram').toLowerCase()];
  if (!send) return Promise.reject(new DeliveryError('unknown channel'));
  return send(feedback, env, now, fetchImpl);
}
