// Turns "the user picked this text on this page" into a translation: resolves the target
// language, works out the source language and calls the active provider.

import { getProvider } from '../providers/index.js';
import { WordvaultError } from './errors.js';
import { matchSupported, normalizeLang, sameLanguage } from './languages.js';
import { getSettings } from './settings.js';

const FALLBACK_TARGET = 'en';
/** Upper bound for one lookup. Wordvault is a vocabulary tool, not a page translator. */
const MAX_CHARS = 500;
/** The browser's language detector needs about a sentence of text to be trustworthy. */
const MIN_DETECTION_SAMPLE = 20;
const MAX_DETECTION_SAMPLE = 1000;

const collapse = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');

async function activeProvider() {
  const settings = await getSettings();
  const provider = getProvider(settings.provider);
  const config = settings.providerConfig?.[provider.id] || {};
  return { settings, provider, config, languages: await provider.getLanguages(config) };
}

function resolveTarget(settings, languages) {
  return (
    matchSupported(settings.targetLang, languages) ||
    matchSupported(chrome.i18n.getUILanguage(), languages) ||
    matchSupported(FALLBACK_TARGET, languages) ||
    languages[0]
  );
}

/** Runs the browser's built-in (offline) detector over the text surrounding the selection. */
async function detectFromSample(sample) {
  if (sample.length < MIN_DETECTION_SAMPLE) return '';
  try {
    const result = await chrome.i18n.detectLanguage(sample.slice(0, MAX_DETECTION_SAMPLE));
    const best = [...(result?.languages || [])].sort((a, b) => b.percentage - a.percentage)[0];
    if (best && (result.isReliable || best.percentage >= 80)) return normalizeLang(best.language);
  } catch {
    // Detection is best effort; the page language and the provider are the fallbacks.
  }
  return '';
}

/**
 * Source-language detection, most to least trustworthy:
 *   1. the built-in detector over the surrounding paragraph (offline, nothing leaves the browser),
 *   2. the `lang` attribute of the page or element,
 *   3. the provider's own detection, which only sees the selected text.
 * A single word is too little for (1) and often for (3), which is why the context comes first.
 */
async function guessSource({ sample, pageLang }, languages) {
  for (const candidate of [await detectFromSample(sample), pageLang]) {
    const match = matchSupported(candidate, languages);
    if (match) return match;
  }
  return null;
}

/** @returns {Promise<{ languages: string[], targetLang: string }>} */
export async function getLanguageInfo() {
  const { settings, languages } = await activeProvider();
  return { languages, targetLang: resolveTarget(settings, languages) };
}

/**
 * @param {Object} request
 * @param {string} request.text       Selected text. The only thing that is sent to the provider.
 * @param {string} [request.sample]   Text around the selection, used for local language detection.
 * @param {string} [request.pageLang] `lang` attribute closest to the selection.
 * @param {string} [request.source]   Source language chosen by the user; skips detection.
 */
export async function translate(request) {
  const text = collapse(request?.text);
  if (!text) throw new WordvaultError('empty');

  const { settings, provider, config, languages } = await activeProvider();
  const tooManyBytes = provider.maxBytes && new TextEncoder().encode(text).length > provider.maxBytes;
  if (text.length > MAX_CHARS || tooManyBytes) throw new WordvaultError('too_long');

  const targetLang = resolveTarget(settings, languages);
  const chosen = matchSupported(request.source, languages);
  if (chosen && sameLanguage(chosen, targetLang)) throw new WordvaultError('same_language');

  let sourceLang = chosen;
  let contextIsTarget = false;
  if (!sourceLang) {
    sourceLang = await guessSource({ sample: collapse(request.sample), pageLang: request.pageLang }, languages);
    // ASSUMPTION: text around the selection being in the user's own language does not settle it,
    // because the selection may be a foreign word quoted in that text ("... 'serendipity'
    // kelimesi ..."). So in that case the context is set aside and the provider detects the
    // language from the selection alone. If its answer is the selection itself, unchanged, the
    // context was right after all and the user gets the "already in your language" message.
    contextIsTarget = Boolean(sourceLang) && sameLanguage(sourceLang, targetLang);
    if (contextIsTarget && provider.supportsAutoDetect) sourceLang = null;
  }
  if (!sourceLang && !provider.supportsAutoDetect) throw new WordvaultError('unsupported_language');

  const result = await provider.translate({ text, source: sourceLang, target: targetLang }, config);
  const detected = matchSupported(result.detectedSource, languages) || normalizeLang(result.detectedSource) || sourceLang || '';
  const unchanged = result.translation.toLowerCase() === text.toLowerCase();
  // Some providers happily "translate" target-language text into itself instead of refusing.
  if (sameLanguage(detected, targetLang) || (contextIsTarget && unchanged)) throw new WordvaultError('same_language');

  return {
    text,
    translation: result.translation,
    alternatives: result.alternatives || [],
    sourceLang: detected,
    targetLang,
    provider: { id: provider.id, name: provider.name },
  };
}
