// The vault: the words the user decided to keep.
//
// Each entry is its own item in chrome.storage.local ("vault:<id>"), so saving or removing a word
// never rewrites the others. Entries are only ever removed by the user.

import { WordvaultError } from './errors.js';

const PREFIX = 'vault:';

const LIMITS = { text: 500, translation: 1000, alternative: 200, alternatives: 8, sentence: 600, url: 2000, title: 300, lang: 35 };

/**
 * @typedef {Object} VaultEntry
 * @property {string} id            See entryId().
 * @property {string} text          The word or phrase, as it was selected.
 * @property {string} sourceLang    Language of `text` ('' if it could not be determined).
 * @property {string} targetLang    Language of `translation`.
 * @property {string} translation   '' when the word was saved without a translation.
 * @property {string[]} alternatives  Other target-language equivalents.
 * @property {string} sentence      Sentence the word was found in ('' if none).
 * @property {string} url           Address of the page it was saved from ('' if unknown).
 * @property {string} title         Title of that page.
 * @property {number} createdAt     Milliseconds since the epoch.
 */

const clip = (value, max) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/**
 * Identity of a vault entry: the same text in the same language pair is the same entry, however
 * it is capitalised. The text comes last, so it may itself contain the separator.
 */
export function entryId({ text, sourceLang, targetLang }) {
  return [clip(sourceLang, LIMITS.lang), clip(targetLang, LIMITS.lang), clip(text, LIMITS.text).toLowerCase()].join('|');
}

const keyOf = (id) => PREFIX + id;

function safeUrl(value) {
  try {
    const url = new URL(clip(value, LIMITS.url));
    return ['http:', 'https:', 'file:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

/** Builds a well-formed entry from untrusted input (a message from a page, an imported file). */
export function normalizeEntry(raw) {
  const text = clip(raw?.text, LIMITS.text);
  if (!text) throw new WordvaultError('empty');
  const fields = {
    text,
    sourceLang: clip(raw.sourceLang, LIMITS.lang),
    targetLang: clip(raw.targetLang, LIMITS.lang),
  };
  const createdAt = Number(raw.createdAt);
  return {
    id: entryId(fields),
    ...fields,
    translation: clip(raw.translation, LIMITS.translation),
    alternatives: (Array.isArray(raw.alternatives) ? raw.alternatives : [])
      .map((item) => clip(item, LIMITS.alternative))
      .filter(Boolean)
      .slice(0, LIMITS.alternatives),
    sentence: clip(raw.sentence, LIMITS.sentence),
    url: safeUrl(raw.url),
    title: clip(raw.title, LIMITS.title),
    createdAt: Number.isFinite(createdAt) && createdAt > 0 ? createdAt : Date.now(),
  };
}

/** @returns {Promise<VaultEntry | null>} */
export async function getEntry(id) {
  const key = keyOf(id);
  return (await chrome.storage.local.get(key))[key] || null;
}

export async function hasEntry(id) {
  return (await getEntry(id)) !== null;
}

/**
 * Saves a word. Saving one that is already there updates it and keeps its original date.
 * @returns {Promise<VaultEntry>} The entry as it is now stored.
 */
export async function addEntry(raw) {
  const entry = normalizeEntry(raw);
  const existing = await getEntry(entry.id);
  if (existing) entry.createdAt = existing.createdAt;
  await chrome.storage.local.set({ [keyOf(entry.id)]: entry });
  // Read it back: the UI only says "saved" for something that is really in storage.
  const stored = await getEntry(entry.id);
  if (!stored) throw new WordvaultError('storage', 'entry missing after write');
  return stored;
}

export async function removeEntry(id) {
  await chrome.storage.local.remove(keyOf(id));
}

/** @returns {Promise<VaultEntry[]>} All entries, newest first. */
export async function listEntries() {
  const all = await chrome.storage.local.get(null);
  return Object.entries(all)
    .filter(([key, value]) => key.startsWith(PREFIX) && value && typeof value === 'object')
    .map(([, value]) => value)
    .sort((a, b) => b.createdAt - a.createdAt);
}
