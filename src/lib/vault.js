// The vault: the words the user decided to keep.
//
// Each entry is its own item in chrome.storage.local ("vault:<id>"), so saving or removing a word
// never rewrites the others. Entries are only ever removed by the user. A removed word leaves a
// small tombstone ("tomb:<id>") behind, so that the removal can travel to the user's other
// devices instead of the word coming back from them (see src/sync).

import { normalizeDictionary } from './dictionary.js';
import { WordvaultError } from './errors.js';

export const ENTRY_PREFIX = 'vault:';
export const TOMBSTONE_PREFIX = 'tomb:';

const LIMITS = { text: 500, translation: 1000, alternative: 200, alternatives: 8, sentence: 600, url: 2000, title: 300, lang: 35, box: 20 };

/** The fields that are synchronised between devices. Changing one of them is an edit. */
const SYNCED_FIELDS = ['text', 'translation', 'sourceLang', 'targetLang', 'sentence', 'box', 'dueAt'];

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
 * @property {number} updatedAt     When a synchronised field last changed.
 * @property {number} rev           Edit counter of this word across all devices: every edit made
 *                                  after seeing revision n is revision n + 1 (see sync/merge.js).
 * @property {number} box           Leitner box (0 = new).
 * @property {number} dueAt         When the word is next due for review (0 = not scheduled).
 * @property {import('./dictionary.js').DictionaryData | null} dictionary
 *   Word types, definitions and examples from Wiktionary; null until they have been fetched.
 * @property {Record<string, unknown>} [syncExtra]
 *   Fields of the synchronised record this version does not know; kept so they are not lost.
 *
 * @typedef {Object} Tombstone
 * @property {string} id
 * @property {number} deletedAt
 * @property {number} rev           Revision of the removal: one more than the removed entry's.
 */

const clip = (value, max) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const positive = (value, fallback) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback);

/**
 * Identity of a vault entry: the same text in the same language pair is the same entry, however
 * it is capitalised. The text comes last, so it may itself contain the separator.
 */
export function entryId({ text, sourceLang, targetLang }) {
  return [clip(sourceLang, LIMITS.lang), clip(targetLang, LIMITS.lang), clip(text, LIMITS.text).toLowerCase()].join('|');
}

export const entryKey = (id) => ENTRY_PREFIX + id;
export const tombstoneKey = (id) => TOMBSTONE_PREFIX + id;

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
  const createdAt = positive(raw.createdAt, Date.now());
  const box = Number(raw.box);
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
    createdAt,
    updatedAt: positive(raw.updatedAt, createdAt),
    rev: Math.max(1, Math.floor(positive(raw.rev, 1))),
    box: Number.isInteger(box) && box >= 0 && box <= LIMITS.box ? box : 0,
    dueAt: positive(raw.dueAt, 0),
    dictionary: normalizeDictionary(raw.dictionary),
  };
}

/** Entries stored by earlier versions lack the fields added for synchronisation. */
function upgrade(entry) {
  if (!entry || typeof entry !== 'object') return null;
  return {
    ...entry,
    updatedAt: positive(entry.updatedAt, entry.createdAt),
    rev: positive(entry.rev, 1),
    box: positive(entry.box, 0),
    dueAt: positive(entry.dueAt, 0),
  };
}

const editedFields = (before, after) => SYNCED_FIELDS.some((field) => before[field] !== after[field]);

/** @returns {Promise<VaultEntry | null>} */
export async function getEntry(id) {
  const key = entryKey(id);
  return upgrade((await chrome.storage.local.get(key))[key]);
}

export async function hasEntry(id) {
  return (await getEntry(id)) !== null;
}

/** @returns {Promise<Tombstone | null>} */
async function getTombstone(id) {
  const key = tombstoneKey(id);
  return (await chrome.storage.local.get(key))[key] || null;
}

/**
 * Saves a word. Saving one that is already there updates it and keeps its original date and
 * review progress.
 * @returns {Promise<VaultEntry>} The entry as it is now stored.
 */
export async function addEntry(raw) {
  const entry = normalizeEntry(raw);
  const existing = await getEntry(entry.id);
  const now = Date.now();
  if (existing) {
    entry.createdAt = existing.createdAt;
    entry.dictionary ||= existing.dictionary || null;
    if (raw.box === undefined) entry.box = existing.box;
    if (raw.dueAt === undefined) entry.dueAt = existing.dueAt;
    if (existing.syncExtra) entry.syncExtra = existing.syncExtra;
    const edited = editedFields(existing, entry);
    entry.rev = edited ? existing.rev + 1 : existing.rev;
    entry.updatedAt = edited ? now : existing.updatedAt;
  } else {
    // Adding a word again after removing it is an edit that follows the removal.
    const tombstone = await getTombstone(entry.id);
    entry.rev = Math.max(entry.rev, (tombstone?.rev || 0) + 1);
    entry.updatedAt = now;
  }
  await chrome.storage.local.set({ [entryKey(entry.id)]: entry });
  await chrome.storage.local.remove(tombstoneKey(entry.id));
  // Read it back: the UI only says "saved" for something that is really in storage.
  const stored = await getEntry(entry.id);
  if (!stored) throw new WordvaultError('storage', 'entry missing after write');
  return stored;
}

/** Removes a word and leaves a tombstone in its place. */
export async function removeEntry(id) {
  const existing = await getEntry(id);
  if (!existing) return;
  /** @type {Tombstone} */
  const tombstone = { id, deletedAt: Date.now(), rev: existing.rev + 1 };
  await chrome.storage.local.set({ [tombstoneKey(id)]: tombstone });
  await chrome.storage.local.remove(entryKey(id));
}

/**
 * Changes fields of an entry that still exists (it may have been removed in the meantime).
 * Only a change to a synchronised field counts as an edit; filling in dictionary data, for
 * example, does not, or every device would keep "editing" the word for the others.
 * @returns {Promise<VaultEntry | null>}
 */
export async function updateEntry(id, patch) {
  const existing = await getEntry(id);
  if (!existing) return null;
  const entry = { ...existing, ...patch, id: existing.id };
  if (editedFields(existing, entry)) {
    entry.rev = existing.rev + 1;
    entry.updatedAt = Date.now();
  }
  await chrome.storage.local.set({ [entryKey(id)]: entry });
  return entry;
}

/**
 * Adds many entries at once (import). Entries that are already in the vault are left alone.
 * @param {unknown[]} rawEntries Untrusted input.
 * @returns {Promise<{ added: number, skipped: number, invalid: number }>}
 */
export async function importEntries(rawEntries) {
  const all = await chrome.storage.local.get(null);
  const known = new Set(Object.keys(all).filter((key) => key.startsWith(ENTRY_PREFIX)).map((key) => key.slice(ENTRY_PREFIX.length)));
  const now = Date.now();
  const items = {};
  const revived = [];
  const counts = { added: 0, skipped: 0, invalid: 0 };
  for (const raw of rawEntries) {
    let entry;
    try {
      entry = normalizeEntry(raw);
    } catch {
      counts.invalid += 1;
      continue;
    }
    if (known.has(entry.id)) {
      counts.skipped += 1;
      continue;
    }
    // Importing a word that was removed on this device brings it back, as a new edit.
    const tombstone = all[tombstoneKey(entry.id)];
    if (tombstone) {
      entry.rev = Math.max(entry.rev, positive(tombstone.rev, 0) + 1);
      entry.updatedAt = now;
      revived.push(tombstoneKey(entry.id));
    }
    known.add(entry.id);
    items[entryKey(entry.id)] = entry;
    counts.added += 1;
  }
  if (counts.added > 0) await chrome.storage.local.set(items);
  if (revived.length > 0) await chrome.storage.local.remove(revived);
  return counts;
}

/** @returns {Promise<VaultEntry[]>} All entries, newest first. */
export async function listEntries() {
  const all = await chrome.storage.local.get(null);
  return Object.entries(all)
    .filter(([key, value]) => key.startsWith(ENTRY_PREFIX) && value && typeof value === 'object')
    .map(([, value]) => upgrade(value))
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** @returns {Promise<Tombstone[]>} */
export async function listTombstones() {
  const all = await chrome.storage.local.get(null);
  return Object.entries(all)
    .filter(([key, value]) => key.startsWith(TOMBSTONE_PREFIX) && value && typeof value === 'object')
    .map(([, value]) => value);
}
