// This device's side of synchronisation: the vault as a document, and a document back into the
// vault. The synchronisation engine reads the local document, merges it with the remote one and
// applies the result here.

import { ENTRY_PREFIX, TOMBSTONE_PREFIX, entryKey, tombstoneKey } from '../lib/vault.js';
import { compareVersions } from './merge.js';
import { emptyDocument, fromRecord, isTombstone, streakSection, toRecord, toTombstone } from './model.js';
import { addRemoteDays, getDays } from '../quiz/streak.js';
import { applyPrefs, mergePrefs, prefsFingerprint, readPrefs, withoutKeys } from './prefs.js';
import { hasExams } from '../exam/merge.js';
import { applyExamSection, readExamSection } from '../exam/history.js';

async function readState() {
  const all = await chrome.storage.local.get(null);
  const entries = {};
  const tombstones = {};
  for (const [key, value] of Object.entries(all)) {
    if (!value || typeof value !== 'object') continue;
    if (key.startsWith(ENTRY_PREFIX)) entries[key.slice(ENTRY_PREFIX.length)] = value;
    else if (key.startsWith(TOMBSTONE_PREFIX)) tombstones[key.slice(TOMBSTONE_PREFIX.length)] = value;
  }
  return { entries, tombstones };
}

/** Entries written before synchronisation existed have no revision or update time yet. */
const withDefaults = (entry) => ({ ...entry, updatedAt: entry.updatedAt || entry.createdAt, rev: entry.rev || 1, box: entry.box || 0, dueAt: entry.dueAt || 0, quiz: entry.quiz || null });

function documentFrom({ entries, tombstones }) {
  const document = emptyDocument();
  // An id has either an entry or a tombstone; should both exist, the entry is the live one.
  for (const [id, tombstone] of Object.entries(tombstones)) document.e[id] = toTombstone(tombstone);
  for (const [id, entry] of Object.entries(entries)) document.e[id] = toRecord(withDefaults(entry));
  return document;
}

/**
 * The vault of this device, removals included, its settings and its past tests, as a synchronised document.
 * @param {{ withKeys?: boolean, withExams?: boolean }} [options]  withKeys: carry the API keys (an
 *        encrypted document only); withExams: carry the past tests (not with browser sync).
 */
export async function readLocalDocument({ withKeys = false, withExams = true } = {}) {
  const document = documentFrom(await readState());
  const streak = streakSection(await getDays());
  if (streak) document.s = streak;
  const prefs = await readPrefs();
  if (prefs.u > 0) document.p = withKeys ? prefs : withoutKeys(prefs);
  const exams = withExams ? await readExamSection() : null;
  if (hasExams(exams)) document.x = exams;
  return document;
}

/**
 * Brings the vault in line with a document that contains everything this device had when the
 * document was put together (the result of merging the local document with a remote one).
 *
 * Words are only removed here when the document carries a tombstone for them. A word that the
 * document simply does not mention is left alone, so that no mistake elsewhere can empty a vault.
 * And what this device holds in a newer version than the document stays as it is: the vault may
 * have been edited while the document was on its way to the cloud and back.
 *
 * @returns {Promise<{ added: number, updated: number, removed: number, settings?: boolean }>} What changed locally.
 */
export async function applyDocument(document) {
  const { entries, tombstones } = await readState();
  const writes = {};
  const removals = [];
  const changes = { added: 0, updated: 0, removed: 0 };

  for (const [id, value] of Object.entries(document.e)) {
    const entry = entries[id];
    const tombstone = tombstones[id];
    const held = entry ? toRecord(withDefaults(entry)) : tombstone ? toTombstone(tombstone) : null;
    if (held && compareVersions(value, held) <= 0) continue;
    if (isTombstone(value)) {
      if (entry) {
        removals.push(entryKey(id));
        changes.removed += 1;
      }
      writes[tombstoneKey(id)] = { id, deletedAt: value.d, rev: value.r };
    } else {
      writes[entryKey(id)] = fromRecord(id, value, entry || null);
      changes[entry ? 'updated' : 'added'] += 1;
      if (tombstone) removals.push(tombstoneKey(id));
    }
  }
  // Tombstones the document no longer carries have expired.
  for (const id of Object.keys(tombstones)) {
    if (!(id in document.e)) removals.push(tombstoneKey(id));
  }

  if (Object.keys(writes).length > 0) await chrome.storage.local.set(writes);
  if (removals.length > 0) await chrome.storage.local.remove(removals);
  // Quiz days another device knows of are added to this device's; none is ever taken away.
  if (document.s) await addRemoteDays({ days: document.s.d, frozen: document.s.f });
  // The settings: what wins against this device's own (newer, or carrying keys it lacks) is applied.
  if (document.p) {
    const local = await readPrefs();
    const winner = mergePrefs(local.u > 0 ? local : null, document.p);
    if (prefsFingerprint(winner) !== prefsFingerprint(local) || winner.u !== local.u) {
      await applyPrefs(winner);
      changes.settings = true;
    }
  }
  // Past tests: joined with this device's (a test deleted anywhere stays deleted).
  if (document.x && (await applyExamSection(document.x))) changes.tests = true;
  return changes;
}
