// Word type, definitions and example sentences from Wiktionary.
//
// The REST "definition" endpoint only exists on English Wiktionary. It covers words of every
// language, but the definitions themselves are written in English.

import { WordvaultError } from './errors.js';
import { fetchJson } from './http.js';
import { primarySubtag } from './languages.js';

const ENDPOINT = 'https://en.wiktionary.org/api/rest_v1/page/definition/';
/** Dictionaries list words and short expressions; anything longer is not worth a request. */
const MAX_TERM_CHARS = 60;
const MAX_TERM_WORDS = 4;

const LIMITS = { groups: 4, definitions: 3, examples: 2, definitionChars: 400, exampleChars: 300, partOfSpeechChars: 40 };

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/**
 * @typedef {Object} DictionaryData
 * @property {number} fetchedAt
 * @property {{ partOfSpeech: string, definitions: { text: string, examples: { text: string, translation: string }[] }[] }[]} groups
 *   One group per word type ("Noun", "Verb" ...); empty when Wiktionary has no entry.
 */

/** Wiktionary returns HTML fragments. This keeps the text only; the result is shown via textContent. */
function plainText(html, max) {
  if (typeof html !== 'string') return '';
  return html
    .replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body) => {
      if (body[0] !== '#') return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
      const codePoint = /^#x/i.test(body) ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return codePoint > 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : whole;
    })
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function parseExamples(definition) {
  const parsed = Array.isArray(definition.parsedExamples)
    ? definition.parsedExamples
    : (Array.isArray(definition.examples) ? definition.examples : []).map((example) => ({ example }));
  return parsed
    .map((item) => ({ text: plainText(item?.example, LIMITS.exampleChars), translation: plainText(item?.translation, LIMITS.exampleChars) }))
    .filter((example) => example.text)
    .slice(0, LIMITS.examples);
}

function parseGroups(sections) {
  const groups = [];
  for (const section of Array.isArray(sections) ? sections : []) {
    const definitions = (Array.isArray(section?.definitions) ? section.definitions : [])
      .map((definition) => ({ text: plainText(definition?.definition, LIMITS.definitionChars), examples: parseExamples(definition || {}) }))
      .filter((definition) => definition.text) // empty ones are headings for nested senses
      .slice(0, LIMITS.definitions);
    if (definitions.length === 0) continue;
    groups.push({ partOfSpeech: plainText(section.partOfSpeech, LIMITS.partOfSpeechChars), definitions });
    if (groups.length === LIMITS.groups) break;
  }
  return groups;
}

/**
 * Builds DictionaryData from untrusted input (an imported backup), dropping anything malformed.
 * @returns {DictionaryData | null}
 */
export function normalizeDictionary(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.groups)) return null;
  const clip = (value, max) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');
  const groups = raw.groups.slice(0, LIMITS.groups).map((group) => ({
    partOfSpeech: clip(group?.partOfSpeech, LIMITS.partOfSpeechChars),
    definitions: (Array.isArray(group?.definitions) ? group.definitions : [])
      .slice(0, LIMITS.definitions)
      .map((definition) => ({
        text: clip(definition?.text, LIMITS.definitionChars),
        examples: (Array.isArray(definition?.examples) ? definition.examples : [])
          .slice(0, LIMITS.examples)
          .map((example) => ({ text: clip(example?.text, LIMITS.exampleChars), translation: clip(example?.translation, LIMITS.exampleChars) }))
          .filter((example) => example.text),
      }))
      .filter((definition) => definition.text),
  }));
  const fetchedAt = Number(raw.fetchedAt);
  return { fetchedAt: Number.isFinite(fetchedAt) && fetchedAt > 0 ? fetchedAt : Date.now(), groups: groups.filter((group) => group.definitions.length > 0) };
}

async function fetchDefinitions(term) {
  const { status, data } = await fetchJson(ENDPOINT + encodeURIComponent(term.replace(/ /g, '_')), {
    // Wikimedia asks API clients to identify themselves.
    headers: { 'Api-User-Agent': `Wordvault/${chrome.runtime.getManifest().version} (browser extension)` },
  });
  if (status === 404) return null;
  if (status === 429) throw new WordvaultError('rate_limit');
  if (status !== 200 || !data || typeof data !== 'object') throw new WordvaultError('provider_error', `Wiktionary HTTP ${status}`);
  return data;
}

/**
 * Looks a word up in Wiktionary.
 * @param {string} text Word or short expression.
 * @param {string} lang Language of the word; only that language's section is used.
 * @returns {Promise<DictionaryData>} `groups` is empty when there is no entry. Rejects with a
 *   WordvaultError when the request itself fails, so the caller can try again later.
 */
export async function lookupWord(text, lang) {
  const term = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
  const nothing = { fetchedAt: Date.now(), groups: [] };
  if (!term || term.length > MAX_TERM_CHARS || term.split(' ').length > MAX_TERM_WORDS) return nothing;

  // Page titles are case-sensitive: "Serendipity" (start of a sentence) lives at "serendipity",
  // while German nouns such as "Schmetterling" keep their capital.
  let data = await fetchDefinitions(term);
  if (!data && term !== term.toLowerCase()) data = await fetchDefinitions(term.toLowerCase());
  if (!data) return nothing;

  const language = primarySubtag(lang);
  // Without a known language there is no way to tell which section is meant; with exactly one
  // real section there is nothing to choose.
  const sections = Object.keys(data).filter((key) => key !== 'other');
  const key = language && data[language] ? language : !language && sections.length === 1 ? sections[0] : '';
  return { fetchedAt: Date.now(), groups: parseGroups(data[key]) };
}
