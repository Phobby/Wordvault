// The vault on one device: edits get revisions, removals leave tombstones, and the vault can be
// read as, and updated from, a synchronised document. No provider is involved.

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { addEntry, getEntry, importEntries, listEntries, listTombstones, removeEntry, updateEntry } from '../src/lib/vault.js';
import { applyDocument, readLocalDocument } from '../src/sync/local.js';
import { mergeDocuments, purgeTombstones, serializeDocument } from '../src/sync/merge.js';
import { TOMBSTONE_TTL_MS, isTombstone } from '../src/sync/model.js';
import { createDevice, use } from './helpers/chrome.js';

const T0 = 1_790_000_000_000;
const DAY = 86_400_000;
const BOOK = { text: 'book', sourceLang: 'en', targetLang: 'tr', translation: 'kitap', sentence: 'A good book.', url: 'https://example.com/a', title: 'Page A' };
const ID = 'en|tr|book';

let device;
beforeEach((t) => {
  device = use(createDevice());
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
});
const at = (t, time) => t.mock.timers.setTime(time);

test('a new word starts at revision 1; only edits to synchronised fields raise it', async (t) => {
  let entry = await addEntry(BOOK);
  assert.deepEqual([entry.rev, entry.updatedAt, entry.createdAt, entry.box, entry.dueAt], [1, T0, T0, 0, 0]);

  at(t, T0 + 1000);
  entry = await updateEntry(ID, { dictionary: { fetchedAt: T0, groups: [] } });
  assert.deepEqual([entry.rev, entry.updatedAt], [1, T0], 'dictionary data is local: not an edit');
  entry = await addEntry(BOOK);
  assert.deepEqual([entry.rev, entry.updatedAt], [1, T0], 'saving the same thing again is not an edit');
  assert.ok(entry.dictionary, 'and keeps what was already known');

  entry = await addEntry({ ...BOOK, translation: 'defter' });
  assert.deepEqual([entry.rev, entry.updatedAt, entry.createdAt], [2, T0 + 1000, T0]);

  at(t, T0 + 2000);
  entry = await updateEntry(ID, { box: 1, dueAt: T0 + DAY });
  assert.deepEqual([entry.rev, entry.updatedAt, entry.box], [3, T0 + 2000, 1]);
  entry = await addEntry({ ...BOOK, translation: 'defter' });
  assert.deepEqual([entry.rev, entry.box, entry.dueAt], [3, 1, T0 + DAY], 'saving again from a page keeps the review progress');
});

test('removing a word leaves a tombstone one revision later', async (t) => {
  await addEntry(BOOK);
  at(t, T0 + 5000);
  await removeEntry(ID);
  assert.equal(await getEntry(ID), null);
  assert.deepEqual(await listEntries(), []);
  assert.deepEqual(await listTombstones(), [{ id: ID, deletedAt: T0 + 5000, rev: 2 }]);

  await removeEntry('en|tr|never-existed');
  assert.equal((await listTombstones()).length, 1, 'removing nothing leaves nothing');
});

test('adding a removed word again is a newer edit and clears the tombstone', async (t) => {
  await addEntry(BOOK);
  await removeEntry(ID);
  at(t, T0 + 9000);
  const entry = await addEntry(BOOK);
  assert.deepEqual([entry.rev, entry.updatedAt], [3, T0 + 9000]);
  assert.deepEqual(await listTombstones(), []);
});

test('importing a backup revives removed words as new edits and leaves existing ones alone', async (t) => {
  await addEntry(BOOK);
  await addEntry({ ...BOOK, text: 'door', translation: 'kapı' });
  await removeEntry(ID);
  at(t, T0 + 4000);
  const counts = await importEntries([{ ...BOOK, createdAt: T0 - DAY }, { ...BOOK, text: 'door', translation: 'KAPI' }, { ...BOOK, text: 'tree', translation: 'ağaç', rev: 7, updatedAt: T0 - 5 }]);
  assert.deepEqual(counts, { added: 2, skipped: 1, invalid: 0 });
  const book = await getEntry(ID);
  assert.deepEqual([book.rev, book.updatedAt, book.createdAt], [3, T0 + 4000, T0 - DAY]);
  assert.equal((await getEntry('en|tr|door')).translation, 'kapı');
  assert.deepEqual([(await getEntry('en|tr|tree')).rev, (await getEntry('en|tr|tree')).updatedAt], [7, T0 - 5], 'a backup keeps its revisions');
  assert.deepEqual(await listTombstones(), []);
});

test('words saved before synchronisation existed are read with sensible defaults', async () => {
  await chrome.storage.local.set({ [`vault:${ID}`]: { id: ID, text: 'book', sourceLang: 'en', targetLang: 'tr', translation: 'kitap', alternatives: [], sentence: '', url: '', title: '', createdAt: T0 - DAY, dictionary: null } });
  const entry = await getEntry(ID);
  assert.deepEqual([entry.rev, entry.updatedAt, entry.box, entry.dueAt], [1, T0 - DAY, 0, 0]);
  assert.deepEqual((await readLocalDocument()).e[ID], { w: 'book', t: 'kitap', sl: 'en', tl: 'tr', u: T0 - DAY, r: 1 });
});

test('the local document holds words and removals, and only those', async () => {
  await addEntry(BOOK);
  await addEntry({ ...BOOK, text: 'door', translation: 'kapı' });
  await removeEntry('en|tr|door');
  await chrome.storage.local.set({ settings: { targetLang: 'tr', providerConfig: { deepl: { apiKey: 'SECRET-KEY' } } }, siteSourceLangs: { 'example.com': 'de' } });
  const document = await readLocalDocument();
  assert.deepEqual(document, { v: 2, e: { 'en|tr|door': { d: T0, r: 2 }, [ID]: { w: 'book', t: 'kitap', sl: 'en', tl: 'tr', c: 'A good book.', u: T0, r: 1 } } });
  const text = serializeDocument(document);
  for (const secret of ['SECRET-KEY', 'example.com', 'Page A', 'settings']) assert.ok(!text.includes(secret), `"${secret}" must not leave the device`);
});

test('applying a merged document: new, changed and removed words; local knowledge is kept', async (t) => {
  await addEntry(BOOK);
  await updateEntry(ID, { dictionary: { fetchedAt: T0, groups: [] }, alternatives: ['defter'] });
  await addEntry({ ...BOOK, text: 'door', translation: 'kapı' });
  await addEntry({ ...BOOK, text: 'local-only', translation: 'yerel' });
  const remote = {
    v: 1,
    e: {
      [ID]: { w: 'book', t: 'kitap (düzeltildi)', sl: 'en', tl: 'tr', c: 'A good book.', b: 2, u: T0 + 50, r: 2 },
      'en|tr|door': { d: T0 + 60, r: 2 },
      'en|tr|tree': { w: 'tree', t: 'ağaç', sl: 'en', tl: 'tr', u: T0 + 70, r: 1 },
    },
  };
  at(t, T0 + 1000);
  const merged = mergeDocuments(await readLocalDocument(), remote);
  assert.deepEqual(await applyDocument(merged), { added: 1, updated: 1, removed: 1 });

  const book = await getEntry(ID);
  assert.deepEqual([book.translation, book.rev, book.updatedAt, book.box], ['kitap (düzeltildi)', 2, T0 + 50, 2]);
  assert.deepEqual([book.url, book.title, book.alternatives, book.createdAt, Boolean(book.dictionary)], ['https://example.com/a', 'Page A', ['defter'], T0, true], 'what only this device knows is kept');
  assert.equal(await getEntry('en|tr|door'), null, 'removed elsewhere, removed here');
  assert.deepEqual((await listTombstones()).find((tombstone) => tombstone.id === 'en|tr|door'), { id: 'en|tr|door', deletedAt: T0 + 60, rev: 2 });
  assert.equal((await getEntry('en|tr|tree')).translation, 'ağaç');
  assert.equal((await getEntry('en|tr|local-only')).translation, 'yerel');

  assert.deepEqual(await applyDocument(merged), { added: 0, updated: 0, removed: 0 }, 'applying the same document again changes nothing');
  assert.equal(serializeDocument(await readLocalDocument()), serializeDocument(merged), 'the vault now is the merged document');
});

test('a document never removes a word it merely does not mention', async () => {
  await addEntry(BOOK);
  await applyDocument({ v: 1, e: {} });
  assert.ok(await getEntry(ID));
});

test('a removal on one device reaches the other and the word does not come back', async (t) => {
  const a = createDevice('A');
  const b = createDevice('B');
  const exchange = async () => {
    // What the engine will do, without a provider in between: both sides merge and apply.
    use(a);
    const fromA = await readLocalDocument();
    use(b);
    const merged = mergeDocuments(fromA, await readLocalDocument());
    await applyDocument(merged);
    use(a);
    await applyDocument(merged);
    return merged;
  };

  use(a);
  await addEntry(BOOK);
  await exchange();
  use(b);
  assert.equal((await getEntry(ID)).translation, 'kitap', 'B received the word');

  at(t, T0 + DAY);
  use(a);
  await removeEntry(ID);
  let merged = await exchange();
  assert.ok(isTombstone(merged.e[ID]));
  use(b);
  assert.equal(await getEntry(ID), null, 'B lost the word too');
  merged = await exchange();
  merged = await exchange();
  use(a);
  assert.equal(await getEntry(ID), null, 'and repeated synchronisation does not bring it back');

  // B adds it again later: the newer edit wins on both devices.
  at(t, T0 + 2 * DAY);
  use(b);
  const again = await addEntry({ ...BOOK, translation: 'kitap!' });
  assert.equal(again.rev, 3);
  await exchange();
  use(a);
  assert.equal((await getEntry(ID)).translation, 'kitap!');
  assert.deepEqual(await listTombstones(), []);
});

test('expired tombstones disappear from the device at the next synchronisation', async (t) => {
  await addEntry(BOOK);
  await addEntry({ ...BOOK, text: 'door', translation: 'kapı' });
  await removeEntry(ID);
  at(t, T0 + TOMBSTONE_TTL_MS - 1);
  await applyDocument(purgeTombstones(await readLocalDocument(), Date.now()));
  assert.equal((await listTombstones()).length, 1, 'not yet');
  at(t, T0 + TOMBSTONE_TTL_MS);
  await applyDocument(purgeTombstones(await readLocalDocument(), Date.now()));
  assert.deepEqual(await listTombstones(), []);
  assert.ok(await getEntry('en|tr|door'), 'words are never purged');
});
