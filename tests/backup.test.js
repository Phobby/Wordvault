// Export and import of the vault as a file.

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { backupFileName, createBackup, restoreBackup } from '../src/lib/backup.js';
import { addEntry, updateEntry } from '../src/lib/vault.js';
import { createDevice, use } from './helpers/chrome.js';

let device;
beforeEach(() => {
  device = use(createDevice());
});

const WORD = { text: 'Serendipity', sourceLang: 'en', targetLang: 'tr', translation: 'tesadüf', alternatives: ['şans'], sentence: 'It was pure serendipity.', url: 'https://example.com/a', title: 'A page' };

test('a backup restores on an empty device, dictionary data included', async () => {
  const saved = await addEntry(WORD);
  await updateEntry(saved.id, { dictionary: { fetchedAt: 1, groups: [{ partOfSpeech: 'Noun', definitions: [{ text: 'luck', examples: [] }] }] } });
  await addEntry({ ...WORD, text: 'book', translation: 'kitap' });
  const file = JSON.stringify(await createBackup());
  assert.deepEqual([JSON.parse(file).format, JSON.parse(file).version, JSON.parse(file).entries.length], ['wordvault-backup', 1, 2]);

  device = use(createDevice('second'));
  await chrome.storage.local.set({ settings: { targetLang: 'de' } });
  assert.deepEqual(await restoreBackup(file), { added: 2, skipped: 0, invalid: 0 });
  const stored = device.dump();
  assert.equal(stored['vault:en|tr|serendipity'].dictionary.groups[0].partOfSpeech, 'Noun');
  assert.equal(stored['vault:en|tr|serendipity'].url, 'https://example.com/a');
  assert.deepEqual(stored.settings, { targetLang: 'de' }, 'settings are not part of a backup');
  assert.deepEqual(await restoreBackup(file), { added: 0, skipped: 2, invalid: 0 }, 'restoring twice adds nothing');
});

test('importing never overwrites a word that is already there', async () => {
  await addEntry({ ...WORD, translation: 'mine' });
  const file = JSON.stringify({ format: 'wordvault-backup', version: 1, entries: [{ ...WORD, translation: 'theirs' }] });
  assert.deepEqual(await restoreBackup(file), { added: 0, skipped: 1, invalid: 0 });
  assert.equal(device.dump()['vault:en|tr|serendipity'].translation, 'mine');
});

test('whatever a file contains, only well-formed words get in, and only as plain data', async () => {
  const file = JSON.stringify({
    format: 'wordvault-backup',
    version: 1,
    entries: [
      { text: 'kedi', sourceLang: 'tr', targetLang: 'en', translation: 'cat', url: 'javascript:alert(1)', dictionary: { groups: [{ partOfSpeech: '<img onerror=x>', definitions: [{ text: 'd'.repeat(5000), examples: 'nope' }, { nope: 1 }] }, 'junk'] }, extra: { evil: true } },
      { nope: true },
      null,
      'string',
      { text: '' },
      { text: 'kedi', sourceLang: 'tr', targetLang: 'en' },
    ],
  });
  assert.deepEqual(await restoreBackup(file), { added: 1, skipped: 1, invalid: 4 });
  const kedi = device.dump()['vault:tr|en|kedi'];
  assert.equal(kedi.url, '', 'a script address is not kept');
  assert.equal(kedi.extra, undefined);
  assert.equal(kedi.dictionary.groups.length, 1);
  assert.equal(kedi.dictionary.groups[0].definitions[0].text.length, 400);
});

test('a bare list of words is accepted; anything else is refused', async () => {
  assert.deepEqual(await restoreBackup(JSON.stringify([{ text: 'ev', sourceLang: 'tr', targetLang: 'en', translation: 'house' }])), { added: 1, skipped: 0, invalid: 0 });
  for (const bad of ['not json', '{"format":"something-else","entries":[]}', '{"entries":[]}', '42', 'null']) {
    await assert.rejects(restoreBackup(bad), (error) => error.code === 'bad_backup', bad);
  }
});

test('the file is named after the day it was made', () => {
  assert.equal(backupFileName(new Date(2026, 9, 11)), 'wordvault-2026-10-11.json');
});
