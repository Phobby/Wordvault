// The synchronised document: what travels between a user's devices.
//
//   { v: 2, e: { "<id>": <record> | <tombstone>, ... }, s: { d: [...], f: [...] } }
//
//   record     a word in the vault        { w, t, sl, tl, c, b, n, q, u, r, k }
//   tombstone  a word that was removed    { d, r }
//
//   w  word                  t  translation          sl / tl  source / target language
//   c  context sentence      b  Leitner box          n  next review (ms since the epoch)
//   u  updated at (ms)       d  deleted at (ms)      r  revision (see merge.js)
//   k  kind: 'p' for a phrase (a translated selection kept as such); left out for a word
//   q  quiz statistics: a summary of how the word has been answered (quiz/learning.js:
//      CardStats); there is no answer history, so the document does not grow with use
//
//   s  the streak (since version 2; left out while empty): d = the days a quiz was done,
//      f = missed days covered by a freeze, both as 'YYYY-MM-DD' in the user's local time.
//      Lists, not counters: two devices' lists merge by taking every day that is in either,
//      so there is nothing to conflict (quiz/progress.js).
//
// Version 2 also added fields to q (learned state, a count per way of asking). A document of
// version 1 is read as it is; what this version writes is version 2, which a version-1
// installation refuses to rewrite until it is updated.
//
// The keys are short because the document has to fit into small quotas (browser sync holds
// about 100 KB). Empty values are left out. The id is the key and is derived from the word and
// its language pair (lib/vault.js: entryId), so it is not repeated inside the value.
//
// Deliberately NOT part of the document: page addresses and titles, the alternatives and the
// dictionary data of a word, the translation cache, settings, API keys and sign-in tokens.

import { WordvaultError } from '../lib/errors.js';
import { PHRASE, entryId } from '../lib/vault.js';
import { normalizeStats } from '../quiz/learning.js';
import { cleanDays } from '../quiz/progress.js';

export const SCHEMA_VERSION = 2;
/** Tombstones older than this are dropped at the next synchronisation. */
export const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
/** "A short context sentence": the full one stays on the device it was saved on. */
const MAX_CONTEXT_CHARS = 160;

const RECORD_KEYS = new Set(['w', 't', 'sl', 'tl', 'c', 'b', 'n', 'q', 'u', 'r', 'k']);

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isTime = (value) => Number.isFinite(value) && value > 0;
const isRevision = (value) => Number.isInteger(value) && value > 0;

/** @returns {boolean} Whether a value of the document stands for a removed word. */
export function isTombstone(value) {
  return isObject(value) && value.w === undefined && isTime(value.d);
}

/** The moment a record or tombstone was last changed. */
export const timeOf = (value) => (isTombstone(value) ? value.d : value.u);

export function emptyDocument() {
  return { v: SCHEMA_VERSION, e: {} };
}

/** Cuts a sentence at a word boundary so that it fits the context limit. */
function shorten(sentence) {
  const text = typeof sentence === 'string' ? sentence.trim() : '';
  if (text.length <= MAX_CONTEXT_CHARS) return text;
  const cut = text.slice(0, MAX_CONTEXT_CHARS - 1);
  return `${cut.slice(0, cut.lastIndexOf(' ') > MAX_CONTEXT_CHARS / 2 ? cut.lastIndexOf(' ') : cut.length).trimEnd()}…`;
}

/**
 * The synchronised form of a vault entry.
 * @param {import('../lib/vault.js').VaultEntry} entry
 */
export function toRecord(entry) {
  const record = { ...(isObject(entry.syncExtra) ? entry.syncExtra : {}), w: entry.text, u: entry.updatedAt, r: entry.rev };
  if (entry.translation) record.t = entry.translation;
  if (entry.sourceLang) record.sl = entry.sourceLang;
  if (entry.targetLang) record.tl = entry.targetLang;
  const context = shorten(entry.sentence);
  if (context) record.c = context;
  if (entry.box > 0) record.b = entry.box;
  if (entry.dueAt > 0) record.n = entry.dueAt;
  if (entry.quiz) record.q = entry.quiz;
  if (entry.kind === PHRASE) record.k = 'p';
  return record;
}

/** @param {import('../lib/vault.js').Tombstone} tombstone */
export function toTombstone(tombstone) {
  return { d: tombstone.deletedAt, r: tombstone.rev };
}

/**
 * The vault entry for a synchronised record. Everything a device knows about the word beyond
 * the record (page address, dictionary data, the full sentence) is taken from the entry it
 * already has, if any.
 * @param {string} id
 * @param {object} record
 * @param {import('../lib/vault.js').VaultEntry | null} existing
 * @returns {import('../lib/vault.js').VaultEntry}
 */
export function fromRecord(id, record, existing) {
  const context = record.c || '';
  const extra = Object.fromEntries(Object.entries(record).filter(([key]) => !RECORD_KEYS.has(key)));
  const entry = {
    id,
    text: record.w,
    sourceLang: record.sl || '',
    targetLang: record.tl || '',
    translation: record.t || '',
    alternatives: existing?.alternatives || [],
    // This device's own, longer sentence survives if the synchronised one is its short form.
    sentence: existing?.sentence && shorten(existing.sentence) === context ? existing.sentence : context,
    url: existing?.url || '',
    title: existing?.title || '',
    createdAt: existing?.createdAt || record.u,
    updatedAt: record.u,
    rev: record.r,
    box: record.b || 0,
    dueAt: record.n || 0,
    quiz: normalizeStats(record.q, { keepUnknown: true }),
    dictionary: existing?.dictionary || null,
  };
  if (record.k === 'p') entry.kind = PHRASE;
  // The note is this device's own (it does not travel): it stays with the word.
  if (existing?.note) entry.note = existing.note;
  if (Object.keys(extra).length > 0) entry.syncExtra = extra;
  return entry;
}

function validRecord(id, value) {
  return (
    typeof value.w === 'string' &&
    value.w.trim() !== '' &&
    isTime(value.u) &&
    isRevision(value.r) &&
    ['t', 'sl', 'tl', 'c', 'k'].every((key) => value[key] === undefined || typeof value[key] === 'string') &&
    ['b', 'n'].every((key) => value[key] === undefined || (Number.isFinite(value[key]) && value[key] >= 0)) &&
    (value.q === undefined || isObject(value.q)) &&
    entryId({ text: value.w, sourceLang: value.sl, targetLang: value.tl }) === id
  );
}

/**
 * Checks a document that came from outside (the cloud, another device) and returns a clean
 * copy. Entries that are not well-formed are dropped. A document written by a newer version of
 * the format is refused as a whole, so that this version never rewrites data it does not
 * understand.
 *
 * @param {unknown} raw   Parsed JSON, or null/undefined for "nothing stored yet".
 * @returns {{ v: number, e: Record<string, object> }}
 */
export function normalizeDocument(raw) {
  if (raw === null || raw === undefined) return emptyDocument();
  if (!isObject(raw) || !Number.isInteger(raw.v) || raw.v < 1 || !isObject(raw.e)) throw new WordvaultError('sync_bad_document');
  if (raw.v > SCHEMA_VERSION) throw new WordvaultError('sync_newer_schema', `document version ${raw.v}, supported ${SCHEMA_VERSION}`);
  const document = emptyDocument();
  for (const [id, value] of Object.entries(raw.e)) {
    if (!isObject(value)) continue;
    if (isTombstone(value) ? isRevision(value.r) : validRecord(id, value)) document.e[id] = value;
  }
  const streak = streakSection(isObject(raw.s) ? { days: raw.s.d, frozen: raw.s.f } : null);
  if (streak) document.s = streak;
  return document;
}

/**
 * The streak part of a document from lists of days, or null when there is nothing to carry.
 * @param {{ days?: unknown, frozen?: unknown } | null} lists
 * @returns {{ d: string[], f?: string[] } | null}
 */
export function streakSection(lists) {
  const days = cleanDays(lists?.days);
  const frozen = cleanDays(lists?.frozen);
  if (days.length === 0 && frozen.length === 0) return null;
  return frozen.length > 0 ? { d: days, f: frozen } : { d: days };
}
