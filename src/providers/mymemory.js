// MyMemory (https://mymemory.translated.net/doc/spec.php): free, no API key.
// Anonymous usage is limited to 5000 characters per day per IP address.

import { WordvaultError } from '../lib/errors.js';
import { fetchJson } from '../lib/http.js';
import { sameLanguage } from '../lib/languages.js';
import { looksDamaged } from '../lib/text-damage.js';

const ENDPOINT = 'https://api.mymemory.translated.net/get';
const AUTODETECT = 'Autodetect';
const MAX_ALTERNATIVES = 4;
const MAX_ALTERNATIVE_CHARS = 80;
/** Queries up to this length are treated as "a word or short phrase" (see translate()). */
const SHORT_TEXT_CHARS = 40;

// MyMemory has no endpoint that lists its languages. Every code below was checked against the
// live API (en -> code) and answered with a translation.
const LANGUAGES = (
  'af sq am ar hy az eu be bn bs bg ca zh-CN zh-TW co hr cs da nl en eo et fi fr fy gl ka de el ' +
  'gu ht ha haw he hi hmn hu is ig id ga it ja kn kk km rw ko ku ky lo la lv lt lb mk mg ms ml ' +
  'mt mi mr mn my ne no ny or ps fa pl pt pt-BR ro ru sm gd sr st sn sd si sk sl so es su sw sv ' +
  'tl tg ta tt te th tr tk uk ur ug uz vi cy xh yi yo zu'
).split(' ');

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** MyMemory sometimes returns HTML entities (&#39;) and stray line breaks inside translations. */
function clean(value) {
  return value
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body) => {
      if (body[0] !== '#') return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
      const codePoint = /^#x/i.test(body) ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return codePoint > 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : whole;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

const fold = (value) => value.trim().toLowerCase();

/** The memory likes to answer "eşitleme, eşitleme"; said once is enough. */
function withoutRepeats(value) {
  const parts = value.split(/\s*,\s*/);
  const unique = parts.filter((part, index) => parts.findIndex((other) => fold(other) === fold(part)) === index);
  return unique.length < parts.length ? unique.join(', ') : value;
}

/**
 * MyMemory's machine translation sometimes loses letters for one spelling of a word and not
 * for another: "sync" comes back as "e? itle", "Sync" as "Eşitle" (seen 2026-10). So a damaged
 * answer is asked for again with the first letter in the other case, and the answer's first
 * letter is put back the way the query had it.
 * @returns {Promise<string | null>} A clean translation, or null.
 */
async function askRecased(text, target, signal) {
  const [first] = text;
  if (!first) return null;
  const upper = first.toLocaleUpperCase();
  const lower = first.toLocaleLowerCase();
  if (upper === lower) return null; // no case to change
  const wasLower = first === lower;
  const again = await request((wasLower ? upper : lower) + text.slice(first.length), null, target, signal).catch(() => null);
  if (!again || looksDamaged(again.translation, text)) return null;
  const [head] = again.translation;
  return (wasLower ? head.toLocaleLowerCase() : head.toLocaleUpperCase()) + again.translation.slice(head.length);
}

async function request(text, source, target, signal = null) {
  const url = new URL(ENDPOINT);
  url.searchParams.set('q', text);
  url.searchParams.set('langpair', `${source || AUTODETECT}|${target}`);
  const { status, data } = await fetchJson(url, { signal });

  // Errors usually arrive as HTTP 200 with the real status (sometimes a string) in the body.
  const responseStatus = Number(data?.responseStatus) || status;
  const details = String(data?.responseDetails || '');
  const translated = data?.responseData?.translatedText;
  const quotaWarning = typeof translated === 'string' && /^MYMEMORY WARNING/i.test(translated);
  if (status === 429 || responseStatus === 429 || data?.quotaFinished === true || quotaWarning) {
    throw new WordvaultError('rate_limit', details);
  }
  if (responseStatus !== 200) {
    if (/DISTINCT LANGUAGES/i.test(details)) throw new WordvaultError('same_language', details);
    if (/INVALID (SOURCE|TARGET) LANGUAGE/i.test(details)) throw new WordvaultError('unsupported_language', details);
    throw new WordvaultError('provider_error', details || `HTTP ${status}`);
  }
  if (typeof translated !== 'string' || !translated.trim()) throw new WordvaultError('no_result');

  return {
    translation: clean(translated),
    detectedSource: data.responseData.detectedLanguage || null,
    matches: Array.isArray(data.matches) ? data.matches : [],
  };
}

/** Translation-memory entries whose source segment is exactly the query (not fuzzy neighbours). */
function exactMatches(matches, text) {
  const wanted = fold(text);
  return matches
    .filter((match) => typeof match?.segment === 'string' && typeof match.translation === 'string')
    .filter((match) => fold(match.segment) === wanted)
    .map((match) => clean(match.translation));
}

function pickAlternatives(candidates, primary, text) {
  const seen = new Set([fold(primary), fold(text)]); // an echo of the query is not a translation
  const alternatives = [];
  for (const candidate of candidates) {
    const key = fold(candidate);
    if (!key || seen.has(key) || candidate.length > MAX_ALTERNATIVE_CHARS) continue;
    seen.add(key);
    alternatives.push(candidate);
    if (alternatives.length === MAX_ALTERNATIVES) break;
  }
  return alternatives;
}

/** @type {import('./index.js').TranslationProvider} */
export const mymemory = {
  id: 'mymemory',
  name: 'MyMemory',
  homepage: 'https://mymemory.translated.net/',
  supportsAutoDetect: true,
  maxBytes: 500,
  configFields: [],

  async getLanguages() {
    return LANGUAGES;
  },

  async translate({ text, source, target }, config, { signal = null } = {}) {
    if (!source) {
      const detected = await request(text, null, target, signal);
      if (!looksDamaged(detected.translation, text)) {
        return { translation: detected.translation, detectedSource: detected.detectedSource, alternatives: [] };
      }
      // Letters were lost on the service's side: ask again another way before showing that.
      const memory = detected.detectedSource ? await request(text, detected.detectedSource, target, signal).catch(() => null) : null;
      const repaired = memory && !looksDamaged(memory.translation, text) ? withoutRepeats(memory.translation) : await askRecased(text, target, signal);
      return { translation: repaired || detected.translation, detectedSource: detected.detectedSource, alternatives: [], damaged: !repaired };
    }

    // With an explicit language pair MyMemory answers from its crowd-sourced translation memory
    // first, which is unreliable for single words ("book" en->tr comes back as "Rezervasyon").
    // The autodetect endpoint skips the memory and returns plain machine translation ("kitap").
    // So for short queries both are requested: the machine translation is the headline (as long
    // as MyMemory detected the same source language we did) and the memory hits become the
    // alternatives. Longer text gets a single request; there the memory rarely has exact hits.
    const isShort = text.length <= SHORT_TEXT_CHARS;
    const [memory, machine] = await Promise.all([
      request(text, source, target, signal).catch((error) => error),
      isShort ? request(text, null, target, signal).catch(() => null) : null,
    ]);
    const machineAgrees = Boolean(machine) && sameLanguage(machine.detectedSource, source);

    if (memory instanceof Error) {
      // A source code MyMemory does not know is not fatal if its own detection found something.
      if (machine && (machineAgrees || memory.code === 'unsupported_language')) {
        return { translation: machine.translation, detectedSource: machine.detectedSource, alternatives: [] };
      }
      throw memory;
    }

    // Either answer may have lost letters on the service's side ("e? itle" for "eşitle"). The
    // clean one is the headline; if neither is, the machine translation is asked for once more
    // with the word in the other case; if that fails too, the user is told.
    const candidates = [machineAgrees ? machine.translation : null, withoutRepeats(memory.translation)].filter(Boolean);
    let translation = candidates.find((candidate) => !looksDamaged(candidate, text));
    let damaged = false;
    if (!translation) {
      translation = (isShort && (await askRecased(text, target, signal))) || candidates[0];
      damaged = looksDamaged(translation, text);
    }
    const alternatives = isShort
      ? pickAlternatives([memory.translation, ...exactMatches(memory.matches, text)].map(withoutRepeats), translation, text).filter((candidate) => !looksDamaged(candidate, text))
      : [];
    return { translation, detectedSource: source, alternatives, damaged };
  },
};
