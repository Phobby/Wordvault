// Export and import of the vault as a JSON file (backup, moving to another device).

import { WordvaultError } from './errors.js';
import { importEntries, listEntries } from './vault.js';

const FORMAT = 'wordvault-backup';
const VERSION = 1;

/** @returns {Promise<{ format: string, version: number, exportedAt: string, entries: object[] }>} */
export async function createBackup() {
  return { format: FORMAT, version: VERSION, exportedAt: new Date().toISOString(), entries: await listEntries() };
}

/** "wordvault-2026-10-11.json" */
export function backupFileName(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `wordvault-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`;
}

/**
 * Merges a backup into the vault. Words that are already there are kept as they are.
 * @param {string} json Contents of a backup file.
 * @returns {Promise<{ added: number, skipped: number, invalid: number }>}
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
  return importEntries(entries);
}

/**
 * Saves the backup as a file. For extension pages only: it needs a document.
 * @returns {Promise<number>} Number of exported words.
 */
export async function downloadBackup() {
  const backup = await createBackup();
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
