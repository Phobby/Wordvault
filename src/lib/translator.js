// Turns "the user picked this text on this page" into a translation: resolves the target
// language, works out the source language and calls the active provider.

import { getProvider } from '../providers/index.js';
import { WordvaultError } from './errors.js';
import { matchSupported, normalizeLang, sameLanguage } from './languages.js';
import { getSettings, getSiteSource, setSiteSource, updateSettings } from './settings.js';

const FALLBACK_TARGET = 'en';
/** Upper bound for one lookup. Wordvault is a vocabulary tool, not a page translator. */
const MAX_CHARS = 500;
/** The browser's language detector needs about a sentence of text to be trustworthy. */
const MIN_DETECTION_SAMPLE = 20;
const MAX_DETECTION_SAMPLE = 1000;

const collapse = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');
const fold = (value) => value.trim().toLowerCase();

async function activeProvider() {
  const settings = await getSettings();
  const provider = getProvider(settings.provider);
  const config = settings.providerConfig?.[provider.id] || {};
  return { settings, provider, config, languages: await provider.getLanguages(config) };
}

/**
 * The one place that decides which language translations are made into: the language the user
 * chose, or, until they have chosen one, the browser's UI language.
 */
function resolveTarget(settings, languages) {
  return (
    matchSupported(settings.targetLang, languages) ||
    matchSupported(chrome.i18n.getUILanguage(), languages) ||
    matchSupported(FALLBACK_TARGET, languages) ||
    languages[0]
  );
}

/** Runs the browser's built-in (offline) language detector. */
async function detect(text, minLength = MIN_DETECTION_SAMPLE) {
  if (text.length < minLength) return '';
  try {
    const result = await chrome.i18n.detectLanguage(text.slice(0, MAX_DETECTION_SAMPLE));
    const best = [...(result?.languages || [])].sort((a, b) => b.percentage - a.percentage)[0];
    if (best && (result.isReliable || best.percentage >= 80)) return normalizeLang(best.language);
  } catch {
    // Detection is best effort; the page language and the provider are the fallbacks.
  }
  return '';
}

/**
 * Source-language detection from the surroundings of the selection, most trustworthy first:
 *   1. the built-in detector over the surrounding paragraph (offline, nothing leaves the browser),
 *   2. the `lang` attribute of the page or element.
 * The provider's own detection, which only sees the selected text, comes after these (see
 * translate()): a single word is too little to detect a language from reliably.
 */
async function guessSource({ sample, pageLang }, languages) {
  for (const candidate of [await detect(sample), pageLang]) {
    const match = matchSupported(candidate, languages);
    if (match) return match;
  }
  return null;
}

/**
 * What a UI needs to show the language controls.
 * @param {string} [host] Host name of the page, for the per-site source language.
 */
export async function getPreferences(host) {
  const { settings, languages } = await activeProvider();
  return {
    languages,
    targetLang: resolveTarget(settings, languages),
    /** False until the user has picked (or confirmed) a target language. */
    targetChosen: Boolean(matchSupported(settings.targetLang, languages)),
    siteSource: matchSupported(await getSiteSource(host), languages) || '',
  };
}

/** Stores the target language. Every UI changes it through here. */
export async function setTargetLanguage(code) {
  const { languages } = await activeProvider();
  const targetLang = matchSupported(code, languages);
  if (!targetLang) throw new WordvaultError('unsupported_language');
  await updateSettings({ targetLang });
  return targetLang;
}

/** Pins (or, with a falsy `code`, unpins) the source language used for a site. */
export async function setSiteSourceLanguage(host, code) {
  const { languages } = await activeProvider();
  const lang = matchSupported(code, languages);
  await setSiteSource(host, lang);
  return lang || '';
}

/**
 * @param {Object} request
 * @param {string} request.text       Selected text. The only thing that is sent to the provider.
 * @param {string} [request.sample]   Text around the selection, used for local language detection.
 * @param {string} [request.pageLang] `lang` attribute closest to the selection.
 * @param {string} [request.source]   Source language picked by the user in the popup.
 * @param {string} [host]             Host name of the page the text is on.
 */
export async function translate(request, host) {
  const text = collapse(request?.text);
  if (!text) throw new WordvaultError('empty');

  const { settings, provider, config, languages } = await activeProvider();
  const tooManyBytes = provider.maxBytes && new TextEncoder().encode(text).length > provider.maxBytes;
  if (text.length > MAX_CHARS || tooManyBytes) throw new WordvaultError('too_long');

  const targetLang = resolveTarget(settings, languages);

  // A source language picked by the user, now or earlier for this site, is used as is. No
  // detection of any kind runs in that case.
  const manual = matchSupported(request.source, languages);
  const pinned = manual ? null : matchSupported(await getSiteSource(host), languages);
  const chosen = manual || pinned;

  let sourceLang = chosen;
  let contextIsTarget = false;
  if (!chosen) {
    const contextLang = await guessSource({ sample: collapse(request.sample), pageLang: request.pageLang }, languages);
    // ASSUMPTION: text around the selection being in the user's own language does not settle it,
    // because the selection may be a foreign word quoted in that text ("... 'serendipity'
    // kelimesi ..."). The translation is attempted anyway, with the provider detecting the
    // language from the selection alone; the result then carries a note instead of an error.
    contextIsTarget = Boolean(contextLang) && sameLanguage(contextLang, targetLang);
    sourceLang = contextIsTarget && provider.supportsAutoDetect ? null : contextLang;
  }

  const outcome = (fields) => ({
    text,
    targetLang,
    translation: '',
    alternatives: [],
    /** Informational: the text looks like it already is in the target language. */
    sameLanguage: false,
    /** How the source language was decided: 'manual', 'site' (pinned for this host) or 'auto'. */
    sourceMode: manual ? 'manual' : pinned ? 'site' : 'auto',
    provider: { id: provider.id, name: provider.name },
    ...fields,
  });

  if (chosen && sameLanguage(chosen, targetLang)) return outcome({ sourceLang: chosen, sameLanguage: true });
  if (!sourceLang && !provider.supportsAutoDetect) {
    throw new WordvaultError('unsupported_language', '', { sourceLang: '', targetLang });
  }

  let result;
  try {
    result = await provider.translate({ text, source: sourceLang, target: targetLang }, config);
  } catch (error) {
    // The provider found the text to be in the target language: that is information for the
    // user, not a failure.
    if (error?.code === 'same_language') return outcome({ sourceLang: targetLang, sameLanguage: true });
    if (error instanceof WordvaultError) {
      throw new WordvaultError(error.code, error.detail, { sourceLang: sourceLang || '', targetLang });
    }
    throw error;
  }

  const detected =
    chosen ||
    matchSupported(result.detectedSource, languages) ||
    normalizeLang(result.detectedSource) ||
    sourceLang ||
    // The provider did not say what it detected: fall back to our own detector on the text.
    matchSupported(await detect(text, 1), languages) ||
    '';
  // A "translation" identical to the selection, in text that surrounds it in the target
  // language, means there was nothing to translate, whatever language the provider guessed.
  const unchanged = fold(result.translation) === fold(text);
  const same = sameLanguage(detected, targetLang) || (contextIsTarget && unchanged);

  return outcome({
    translation: result.translation,
    alternatives: result.alternatives || [],
    sourceLang: same ? targetLang : detected,
    sameLanguage: same,
  });
}
