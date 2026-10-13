// Merging two copies of the synchronised document.
//
// For every word the merge keeps the newer of the two versions, where "newer" is a total order:
//
//   1. higher revision `r`
//   2. later time (`u`, or `d` for a tombstone)
//   3. a tombstone before a record (a removal wins an exact tie)
//   4. the canonical JSON text of the value
//
// Taking the maximum under a total order is commutative, associative and idempotent, so devices
// may synchronise in any order, any number of times, and end up with the same document.
//
// Why a revision counter and not the clock alone: the revision is a per-word Lamport counter.
// Every edit (change, removal, re-adding) made after seeing revision n is stored as n + 1. An
// edit made with knowledge of another therefore always beats it, whatever the two devices'
// clocks say. With time alone, a device whose clock runs a day ahead would win every conflict
// for a day, and a word removed "in the past" by a device with a slow clock would come back.
// The clock only decides between edits made independently of each other (same revision), where
// "the later one wins" is the best that can be done. Rules 3 and 4 make the result independent
// of merge order even when revision and time are equal; rule 4 replaces a per-device identifier,
// which would cost bytes in every record of a document that has to stay small.

import { SCHEMA_VERSION, TOMBSTONE_TTL_MS, isTombstone, streakSection, timeOf } from './model.js';

/** JSON with object keys in sorted order: equal values give equal text on every device. */
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * Orders two versions of the same word.
 * @returns {number} Negative if `a` is older than `b`, positive if newer, 0 if they are equal.
 */
export function compareVersions(a, b) {
  if (a.r !== b.r) return a.r - b.r;
  if (timeOf(a) !== timeOf(b)) return timeOf(a) - timeOf(b);
  const kind = Number(isTombstone(a)) - Number(isTombstone(b));
  if (kind !== 0) return kind;
  const left = canonical(a);
  const right = canonical(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

/** A document with its entries in sorted order, so that equal documents serialise equally. */
function documentOf(entries, streak = null) {
  const document = { v: SCHEMA_VERSION, e: Object.fromEntries(Object.entries(entries).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) };
  if (streak) document.s = streak;
  return document;
}

/** The streak days of two documents as one: every day that is in either (nothing to conflict). */
function mergeStreaks(a, b) {
  return streakSection({ days: [...(a?.d || []), ...(b?.d || [])], frozen: [...(a?.f || []), ...(b?.f || [])] });
}

/**
 * Merges two documents (already checked with normalizeDocument). Neither argument is changed.
 * No word and no removal that is in either of them is missing from the result.
 */
export function mergeDocuments(a, b) {
  const entries = { ...a.e };
  for (const [id, value] of Object.entries(b.e)) {
    if (!(id in entries) || compareVersions(value, entries[id]) > 0) entries[id] = value;
  }
  return documentOf(entries, mergeStreaks(a.s, b.s));
}

/**
 * Drops tombstones that have done their job. Kept separate from mergeDocuments(), which must
 * not depend on the time of day; the synchronisation engine applies it to the merged result.
 * A device that has not synchronised for longer than the tombstone lifetime can bring such a
 * word back: that is the price of not keeping tombstones forever.
 */
export function purgeTombstones(document, now = Date.now()) {
  return documentOf(Object.fromEntries(Object.entries(document.e).filter(([, value]) => !(isTombstone(value) && value.d <= now - TOMBSTONE_TTL_MS))), mergeStreaks(document.s, null));
}

/** The text that is stored and compared: equal documents give equal text. */
export function serializeDocument(document) {
  return canonical(documentOf(document.e, mergeStreaks(document.s, null)));
}

export function documentsEqual(a, b) {
  return serializeDocument(a) === serializeDocument(b);
}
