// DeepL (https://developers.deepl.com/): needs the user's own API key.
//
// Checked against DeepL's documentation on 2026-10-13:
//   - API Free keys end in ":fx" and are used at api-free.deepl.com, all others at api.deepl.com;
//   - the key travels in a header, `Authorization: DeepL-Auth-Key <key>`, never in the address;
//   - POST /v2/translate takes JSON { text: [..], target_lang, source_lang? };
//   - 403: the key was not accepted, 456: the character quota is used up, 429/529: too many requests.
//
// The key is read from the settings (chrome.storage.local) and goes nowhere but into that header.
// It is never put into an error, so it cannot end up in the error log.

import { WordvaultError } from '../lib/errors.js';
import { fetchJson } from '../lib/http.js';

const FREE_BASE = 'https://api-free.deepl.com';
const PRO_BASE = 'https://api.deepl.com';

/** @returns {string} The address a key belongs to. */
export function deeplBase(apiKey) {
  return String(apiKey || '').trim().endsWith(':fx') ? FREE_BASE : PRO_BASE;
}

/** The permission pattern for the host a key is used at. */
export const deeplOrigin = (apiKey) => `${deeplBase(apiKey)}/*`;

// ASSUMPTION: the languages DeepL has offered for years through /v2/languages. Its
// documentation lists many more by now; those could not be tried without a key, so they are
// left out until they can. Codes are Wordvault's (lib/languages.js); the tables below turn
// them into DeepL's.
const LANGUAGES = 'ar bg cs da de el en es et fi fr he hu id it ja ko lt lv nl no pl pt pt-BR ro ru sk sl sv th tr uk vi zh-CN zh-TW'.split(' ');

/** Where DeepL wants a regional variant as the target. ASSUMPTION: plain English is American, plain Portuguese is European. */
const TARGET_CODES = { en: 'EN-US', 'en-us': 'EN-US', 'en-gb': 'EN-GB', pt: 'PT-PT', 'pt-pt': 'PT-PT', 'pt-br': 'PT-BR', 'zh-cn': 'ZH-HANS', 'zh-tw': 'ZH-HANT', no: 'NB' };
/** Variants are targets only; as a source DeepL takes the language itself. */
const SOURCE_CODES = { no: 'NB', nb: 'NB' };
/** DeepL's answer ("detected_source_language") back into Wordvault's codes. */
const FROM_DEEPL = { NB: 'no', ZH: 'zh-CN', 'ZH-HANS': 'zh-CN', 'ZH-HANT': 'zh-TW' };

/** @returns {string} DeepL's code for translating into `code`. */
export function toDeeplTarget(code) {
  const lower = String(code).toLowerCase();
  return TARGET_CODES[lower] || lower.split('-')[0].toUpperCase();
}

/** @returns {string} DeepL's code for translating from `code`. */
export function toDeeplSource(code) {
  const primary = String(code).toLowerCase().split('-')[0];
  return SOURCE_CODES[primary] || primary.toUpperCase();
}

export function fromDeepl(code) {
  const upper = String(code || '').toUpperCase();
  return FROM_DEEPL[upper] || upper.split('-')[0].toLowerCase();
}

const keyOf = (config) => String(config?.apiKey || '').trim();

/** What an HTTP status of DeepL means, as one of our error codes. */
function fail(status, data) {
  // DeepL's own wording says which parameter it did not like; it never contains the key.
  const detail = String(data?.message || '').slice(0, 200);
  if (status === 403) return new WordvaultError('auth', 'the key was not accepted');
  if (status === 456) return new WordvaultError('quota', 'the character quota is used up');
  if (status === 429 || status === 529) return new WordvaultError('rate_limit', 'too many requests');
  if (status === 413) return new WordvaultError('too_long');
  if (status === 400 && /source_lang|target_lang|language/i.test(detail)) return new WordvaultError('unsupported_language', detail);
  return new WordvaultError('provider_error', detail || `HTTP ${status}`);
}

async function call(config, path, init = {}) {
  const apiKey = keyOf(config);
  if (!apiKey) throw new WordvaultError('no_key');
  // The host is an optional permission, asked for in the settings when the key is tested.
  const allowed = await chrome.permissions.contains({ origins: [deeplOrigin(apiKey)] }).catch(() => false);
  if (!allowed) throw new WordvaultError('provider_permission');
  const { status, data } = await fetchJson(`${deeplBase(apiKey)}${path}`, {
    ...init,
    headers: { Authorization: `DeepL-Auth-Key ${apiKey}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
  });
  if (status !== 200) throw fail(status, data);
  return data;
}

/** @type {import('./index.js').TranslationProvider} */
export const deepl = {
  id: 'deepl',
  name: 'DeepL',
  homepage: 'https://www.deepl.com/pro-api',
  supportsAutoDetect: true,
  // DeepL takes far more; a lookup is capped by the translator long before that.
  maxBytes: 0,
  configFields: [{ key: 'apiKey', type: 'password', labelKey: 'optDeeplKey', required: true }],

  async getLanguages() {
    return LANGUAGES;
  },

  async translate({ text, source, target }, config, { signal = null } = {}) {
    const body = { text: [text], target_lang: toDeeplTarget(target) };
    if (source) body.source_lang = toDeeplSource(source);
    const data = await call(config, '/v2/translate', { method: 'POST', body: JSON.stringify(body), signal });
    const [first] = Array.isArray(data?.translations) ? data.translations : [];
    if (typeof first?.text !== 'string' || !first.text.trim()) throw new WordvaultError('no_result');
    return { translation: first.text.trim(), detectedSource: source || fromDeepl(first.detected_source_language) || null, alternatives: [] };
  },

  /**
   * "Test the key": asks how much of the quota is used. Translates nothing.
   * @returns {Promise<{ plan: 'free' | 'pro', used: number, limit: number }>} Rejects like translate().
   */
  async check(config) {
    const data = await call(config, '/v2/usage');
    const used = Number(data?.character_count) || 0;
    const limit = Number(data?.character_limit) || 0;
    if (limit > 0 && used >= limit) throw new WordvaultError('quota', 'the character quota is used up');
    return { plan: keyOf(config).endsWith(':fx') ? 'free' : 'pro', used, limit };
  },
};
