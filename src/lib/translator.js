// Turns "the user picked this text on this page" into a translation: resolves the target
// language, works out the source language and calls the active provider.

import { DEFAULT_PROVIDER_ID, getProvider } from '../providers/index.js';
import { WordvaultError } from './errors.js';
import { matchSupported, normalizeLang, sameLanguage } from './languages.js';
import { getSettings, getSiteSource, setSiteSource, updateSettings } from './settings.js';
import { clearSession, forgetFailure, getFailure, getSession, hasSessionCache, putFailure, putSession, sessionCount } from './session-cache.js';
import { TOUCH_AFTER_MS, cacheKey, cacheStats, clearCache, getCached, putCached, touchCached } from './translation-cache.js';

const FALLBACK_TARGET = 'en';
/** Upper bound for one lookup. Wordvault is a vocabulary tool, not a page translator. */
const MAX_CHARS = 500;
/** The browser's language detector needs about a sentence of text to be trustworthy. */
const MIN_DETECTION_SAMPLE = 20;
const MAX_DETECTION_SAMPLE = 1000;

const collapse = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');
const fold = (value) => value.trim().toLowerCase();

/** @param {string} [override]  A provider to use for this one request instead of the chosen one. */
async function activeProvider(override) {
  const settings = await getSettings();
  const provider = getProvider(override || settings.provider);
  const config = settings.providerConfig?.[provider.id] || {};
  return { settings, provider, config, languages: await provider.getLanguages(config) };
}

/**
 * What an error tells the UI about the service it came from: its name, and, when it is not
 * the default one, the default as something to carry on with. Switching is offered, never done
 * silently.
 */
function providerContext(provider) {
  const fallback = provider.id === DEFAULT_PROVIDER_ID ? null : getProvider(DEFAULT_PROVIDER_ID);
  return { provider: { id: provider.id, name: provider.name }, fallback: fallback && { id: fallback.id, name: fallback.name } };
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

/** The language translations, and quiz answers, are in. */
export async function resolveTargetLanguage() {
  const { settings, languages } = await activeProvider();
  return resolveTarget(settings, languages);
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
 * The answer to a request if it was given before. Looked for where it is quickest first: what
 * the browser holds for this session, then the lasting cache; found in the lasting one, it is
 * put into the session too. (In front of both, each page keeps its own few answers in memory:
 * shared/translate-client.js.)
 */
async function recall(request, now = Date.now()) {
  const key = cacheKey(request);
  const quick = await getSession(key);
  if (quick) {
    // Being asked for counts for the seven days of the lasting entry, whichever layer answered.
    if (now - quick.touched >= TOUCH_AFTER_MS) {
      await touchCached(key, now).catch(() => {});
      await putSession(key, quick.result, now);
    }
    return quick.result;
  }
  const lasting = await getCached(request, now).catch(() => null);
  if (lasting) await putSession(key, lasting, now);
  return lasting;
}

async function remember(request, result, now = Date.now()) {
  await putCached(request, result, now);
  await putSession(cacheKey(request), result, now);
}

// --- Requests under way ---------------------------------------------------------------------
// Not a cache: an entry is there only while its request is on the way and is gone the moment
// the request ends. If this script is stopped, so are its requests, and there is nothing to lose.

/** key -> { promise, controller, waiters }: one request per key, however many ask at once. */
const underWay = new Map();
/** requestId -> a function that takes that one asker out. */
const leaving = new Map();
/** Requests that were given up before they got as far as the service. */
const gaveUpEarly = new Set();

/**
 * Asks the service once per key: whoever asks for the same thing while a request is on the
 * way gets that request's answer. Each asker can leave (cancelTranslation); when the last one
 * has left, the request itself is given up.
 * @param {string} key
 * @param {(signal: AbortSignal) => Promise<Object>} run
 * @param {string} [requestId]
 */
function askOnce(key, run, requestId) {
  if (requestId && gaveUpEarly.delete(requestId)) return Promise.reject(new WordvaultError('aborted', 'given up before it was sent'));
  let flight = underWay.get(key);
  if (!flight) {
    const controller = new AbortController();
    flight = { controller, waiters: 0, promise: null };
    flight.promise = run(controller.signal).finally(() => {
      if (underWay.get(key) === flight) underWay.delete(key);
    });
    flight.promise.catch(() => {}); // every asker handles it; this copy must not count as unhandled
    underWay.set(key, flight);
  }
  flight.waiters += 1;
  return new Promise((resolve, reject) => {
    if (requestId) {
      leaving.set(requestId, () => {
        leaving.delete(requestId);
        flight.waiters -= 1;
        if (flight.waiters <= 0) flight.controller.abort();
        reject(new WordvaultError('aborted', 'given up'));
      });
    }
    flight.promise.then(resolve, reject).finally(() => requestId && leaving.delete(requestId));
  });
}

/** The user moved on: the request with this id is not waited for any more. */
export function cancelTranslation(requestId) {
  if (typeof requestId !== 'string' || !requestId) return false;
  const leave = leaving.get(requestId);
  if (leave) {
    leave();
    return true;
  }
  // not at the service yet (languages are still being worked out): stopped when it gets there
  gaveUpEarly.add(requestId);
  if (gaveUpEarly.size > 50) gaveUpEarly.delete(gaveUpEarly.values().next().value);
  return false;
}

/**
 * @param {Object} request
 * @param {string} request.text       Selected text. The only thing that is sent to the provider.
 * @param {string} [request.sample]   Text around the selection, used for local language detection.
 * @param {string} [request.pageLang] `lang` attribute closest to the selection.
 * @param {string} [request.source]   Source language picked by the user in the popup.
 * @param {string} [request.requestId] Lets the asker give the request up (cancelTranslation).
 * @param {boolean} [request.fresh]   "Try again": a failure remembered for this request is forgotten first.
 * @param {string} [request.provider] Use this service for this request ("continue with …"
 *                                    after the chosen one failed); the setting is not changed.
 * @param {string} [host]             Host name of the page the text is on.
 */
export async function translate(request, host) {
  const text = collapse(request?.text);
  if (!text) throw new WordvaultError('empty');

  const { settings, provider, config, languages } = await activeProvider(request.provider);
  const about = providerContext(provider);
  const tooManyBytes = provider.maxBytes && new TextEncoder().encode(text).length > provider.maxBytes;
  if (text.length > MAX_CHARS || tooManyBytes) throw new WordvaultError('too_long', '', { text, ...about });

  // The language the user chose is not one this service translates into: said, with the
  // language named, instead of quietly translating into some other language.
  if (normalizeLang(settings.targetLang) && !matchSupported(settings.targetLang, languages)) {
    throw new WordvaultError('provider_language', normalizeLang(settings.targetLang), { text, sourceLang: '', targetLang: normalizeLang(settings.targetLang), ...about });
  }
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
    throw new WordvaultError('unsupported_language', '', { text, sourceLang: '', targetLang, ...about });
  }

  // Asked for before, of this service, for this language pair: not asked for again.
  const remembered = { provider: provider.id, source: sourceLang, target: targetLang, text };
  const key = cacheKey(remembered);
  let result = await recall(remembered);
  try {
    if (!result) {
      // It failed a moment ago in a way that asking again does not change: the same error,
      // without another request. "Try again" asks anyway.
      if (request.fresh) await forgetFailure(key);
      const failed = request.fresh ? null : await getFailure(key);
      if (failed) throw new WordvaultError(failed.code, failed.detail);
      result = await askOnce(
        key,
        async (signal) => {
          try {
            const answer = await provider.translate({ text, source: sourceLang, target: targetLang }, config, { signal });
            // an answer that lost letters is not worth remembering: next time may be better
            if (answer.damaged !== true) await remember(remembered, { translation: answer.translation, detectedSource: answer.detectedSource || null, alternatives: answer.alternatives || [] });
            return answer;
          } catch (error) {
            await putFailure(key, error); // only the kinds worth it; never a request that was given up
            throw error;
          }
        },
        request.requestId,
      );
    }
  } catch (error) {
    // The provider found the text to be in the target language: that is information for the
    // user, not a failure.
    if (error?.code === 'same_language') return outcome({ sourceLang: targetLang, sameLanguage: true });
    if (error instanceof WordvaultError) {
      throw new WordvaultError(error.code, error.detail, { text, sourceLang: sourceLang || '', targetLang, ...about });
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
    /** Informational: the service's answer seems to have lost letters, and asking again did not help. */
    damaged: result.damaged === true,
  });
}

/**
 * "Test the key" on the settings page: tries a provider's configuration as it is typed in,
 * without saving it and without translating anything.
 * @param {string} providerId
 * @param {Record<string, string>} config
 */
export async function checkProvider(providerId, config) {
  const provider = getProvider(providerId);
  if (provider.id !== providerId || typeof provider.check !== 'function') throw new WordvaultError('provider_error', 'nothing to check');
  return provider.check(config || {});
}

/**
 * "Clear cache" on the settings page: every layer, in this browser. The vault is something
 * else and is not touched. Pages drop what they hold in memory when they see the lasting
 * cache's epoch change (shared/translate-client.js).
 */
export async function clearTranslationCaches() {
  await clearSession();
  await clearCache();
}

/** What the settings page shows about the cache. */
export async function translationCacheStats() {
  return { ...(await cacheStats()), session: await sessionCount(), hasSession: hasSessionCache() };
}
