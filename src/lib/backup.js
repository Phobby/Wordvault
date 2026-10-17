// Export and import of the vault and the settings as a JSON file (backup, moving to another device).

import { WordvaultError } from './errors.js';
import { addRemoteDays, getDays } from '../quiz/streak.js';
import { importEntries, listEntries } from './vault.js';
import { applyPrefs, normalizePrefs, readPrefs, withoutKeys } from '../sync/prefs.js';
import { applyExamSection, readExamSection } from '../exam/history.js';

const FORMAT = 'wordvault-backup';
/**
 * 2: entries carry the learned state (in `quiz`), and the file the days a quiz was done.
 * 3: the settings (sync/prefs.js), with the API keys only if the user asked for them.
 * 4: the past tests ("Create a test with AI").
 * Older files are read as they are.
 */
const VERSION = 4;

/**
 * @param {{ includeKeys?: boolean }} [options]  includeKeys: the API keys go into the file too
 *        (the user ticked "include API keys"; the file is then as secret as the keys).
 * @returns {Promise<{ format: string, version: number, exportedAt: string, entries: object[], streak: { days: string[], frozen: string[] }, settings: object }>}
 */
export async function createBackup({ includeKeys = false } = {}) {
  const prefs = await readPrefs();
  return { format: FORMAT, version: VERSION, exportedAt: new Date().toISOString(), entries: await listEntries(), streak: await getDays(), settings: includeKeys ? prefs : withoutKeys(prefs), exams: (await readExamSection()).t };
}

/** "wordvault-2026-10-11.json" */
export function backupFileName(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `wordvault-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`;
}

/**
 * Merges a backup into the vault. Words that are already there are kept as they are. The
 * settings of the file replace this device's (it is a restore the user asked for), as a new
 * edit, so that they also reach the other devices; keys the file does not carry stay as they are.
 * @param {string} json Contents of a backup file.
 * @returns {Promise<{ added: number, skipped: number, invalid: number, settings?: boolean }>}
 */
export async function restoreBackup(json) {
  let data;
  try {
    data = JSON.parse(json);
  } catch {
    throw new WordvaultError('bad_backup');
  }
  // A bare array of entries is accepted too, so a hand-made word list can be imported.
  const entries = Array.isArray(data) ? data : data?.format === FORMAT ? data.entries : null;
  if (!Array.isArray(entries)) throw new WordvaultError('bad_backup');
  const counts = await importEntries(entries);
  // The quiz days of the file are added to this device's (cleaned on the way in; none is removed).
  if (!Array.isArray(data) && data.streak && typeof data.streak === 'object') await addRemoteDays(data.streak);
  const prefs = Array.isArray(data) ? null : normalizePrefs(data.settings);
  if (prefs) await applyPrefs(prefs, { stamp: Date.now() });
  // Past tests are joined with this device's; the newest few are kept.
  const tests = !Array.isArray(data) && Array.isArray(data.exams) && (await applyExamSection({ t: data.exams, d: {} }));
  return { ...counts, ...(prefs ? { settings: true } : {}), ...(tests ? { tests: true } : {}) };
}

/**
 * Saves the backup as a file. For extension pages only: it needs a document.
 * @returns {Promise<number>} Number of exported words.
 */
export async function downloadBackup({ includeKeys = false } = {}) {
  const backup = await createBackup({ includeKeys });
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = backupFileName();
  document.body.append(link);
  link.click();
  link.remove();
  // The browser has taken the blob by now; keep the URL a little longer for slow save dialogs.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return backup.entries.length;
}
