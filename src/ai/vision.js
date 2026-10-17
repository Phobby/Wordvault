// Whether the model in use reads pictures ("Ask about the image", features/image-ask).
//
// Providers do not say it in a way that can be asked for: the same OpenAI-compatible address
// serves models that see and models that do not, and a model that does not may refuse the
// picture or quietly answer without it. So it is tried: a small plain red square goes to the
// model with the question what colour it is. "Red" means it sees. Any other answer, or a
// refusal of the request, means it does not. What the model could not be asked at all (no
// network, a wrong key, a used-up quota) tells nothing, and nothing is recorded.
//
// The finding is kept per provider, model and address in the AI configuration (ai/config.js),
// on this device only. It is made by the settings page's "Test" and, failing that, before the
// first picture is sent; a picture refused later as a picture corrects it.

import { WordvaultError } from '../lib/errors.js';

/** A 64×64 plain red PNG. */
export const PROBE_IMAGE = Object.freeze({ mime: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAT0lEQVR42u3PQQkAAAgEsEty/UMZxgi+hcEKLNO+FgEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQGBywLPLIEA68ZURwAAAABJRU5ErkJggg==' });

const PROBE = {
  system: 'You are a vision test. Look at the image and answer with one English word.',
  prompt: 'What is the colour of this image? Answer with one English word.',
};

/** Error codes that are about the model and the request, not about reaching the provider. */
const REFUSED = new Set(['ai_request', 'ai_model', 'ai_empty', 'ai_bad_answer', 'ai_refused']);
/** How providers word "no pictures here" when they refuse one. */
const NO_PICTURES = /image|vision|multi-?modal|modalit|content type|image_url|inline_?data|not support/i;

/** Where the finding is kept: one key per provider, model and address. */
export const visionKey = (providerId, settings) => [providerId, settings.model, settings.baseUrl || ''].join('|');

/** @returns {boolean | null} What is known about the model (null: not tried yet). */
export function knownVision(config, providerId, settings) {
  const value = config?.vision?.[visionKey(providerId, settings)];
  return typeof value === 'boolean' ? value : null;
}

/** Whether a refused request says that the picture was the problem. */
export function refusedPicture(error) {
  return Boolean(error) && REFUSED.has(error.code) && NO_PICTURES.test(String(error.detail || ''));
}

/**
 * Asks the model about the red square.
 * @returns {Promise<boolean>} Whether it reads pictures. Rejects (and decides nothing) when the
 *          provider could not be asked: network, timeout, key, quota, permission.
 */
export async function probeVision(provider, settings, { signal = null, timeoutMs } = {}) {
  try {
    const answer = await provider.generate({ ...PROBE, maxTokens: 1024, image: PROBE_IMAGE }, settings, { signal, timeoutMs });
    return /\bred\b|\breddish\b|crimson|scarlet/i.test(answer);
  } catch (error) {
    if (error instanceof WordvaultError && REFUSED.has(error.code)) return false;
    throw error;
  }
}
