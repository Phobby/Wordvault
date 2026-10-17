// The synchronised form of a word: what is in it, what is not, and how documents from outside
// are checked.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SCHEMA_VERSION, emptyDocument, fromRecord, isTombstone, normalizeDocument, toRecord, toTombstone } from '../src/sync/model.js';

const T0 = 1_790_000_000_000;

const entry = (fields = {}) => ({
  id: 'en|tr|serendipity',
  text: 'Serendipity',
  sourceLang: 'en',
  targetLang: 'tr',
  translation: 'tesadüf',
  alternatives: ['şans'],
  sentence: 'It was pure serendipity.',
  url: 'https://example.com/private/page?token=secret',
  title: 'A private page',
  createdAt: T0,
  updatedAt: T0 + 5,
  rev: 3,
  box: 2,
  dueAt: T0 + 86_400_000,
  dictionary: { fetchedAt: T0, groups: [{ partOfSpeech: 'Noun', definitions: [{ text: 'luck', examples: [] }] }] },
  ...fields,
});

test('a record carries the word under short keys and nothing that must stay on the device', () => {
  const record = toRecord(entry());
  assert.deepEqual(record, { w: 'Serendipity', t: 'tesadüf', sl: 'en', tl: 'tr', c: 'It was pure serendipity.', b: 2, n: T0 + 86_400_000, u: T0 + 5, r: 3 });
  const text = JSON.stringify(record);
  for (const secret of ['example.com', 'token', 'private', 'şans', 'luck', 'Noun']) assert.ok(!text.includes(secret), `"${secret}" must not be synchronised`);
});

test('empty values are left out of a record', () => {
  assert.deepEqual(toRecord(entry({ translation: '', sentence: '', box: 0, dueAt: 0, sourceLang: '' })), { w: 'Serendipity', tl: 'tr', u: T0 + 5, r: 3 });
});

test('the context sentence is shortened for synchronisation, at a word boundary', () => {
  const long = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
  const { c } = toRecord(entry({ sentence: long }));
  assert.ok(c.length <= 160, `${c.length} characters`);
  assert.ok(c.endsWith('…') && long.startsWith(c.slice(0, -1)) && !c.slice(0, -1).endsWith(' '));
  assert.equal(toRecord(entry({ sentence: 'x'.repeat(160) })).c.length, 160, 'a sentence that fits is not touched');
});

test('record -> entry -> record is lossless', () => {
  for (const record of [
    { w: 'Serendipity', t: 'tesadüf', sl: 'en', tl: 'tr', c: 'It was pure serendipity.', b: 2, n: T0 + 9, u: T0 + 5, r: 3 },
    { w: 'kedi', tl: 'en', u: T0, r: 1 },
  ]) {
    const id = record.sl ? 'en|tr|serendipity' : '|en|kedi';
    assert.deepEqual(toRecord(fromRecord(id, record, null)), record);
  }
});

test('an entry built from a record keeps what this device already knows about the word', () => {
  const local = entry({ sentence: `${'The quick brown fox jumps over the lazy dog. '.repeat(6)}End.` });
  const remote = { ...toRecord(local), t: 'rastlantı', u: T0 + 100, r: 4, b: 3 };
  const merged = fromRecord(local.id, remote, local);
  assert.equal(merged.translation, 'rastlantı');
  assert.equal(merged.rev, 4);
  assert.equal(merged.box, 3);
  assert.equal(merged.updatedAt, T0 + 100);
  assert.equal(merged.sentence, local.sentence, 'the full sentence stays although only its short form is synchronised');
  for (const field of ['url', 'title', 'alternatives', 'dictionary', 'createdAt']) assert.deepEqual(merged[field], local[field], field);

  const fresh = fromRecord(local.id, remote, null);
  assert.equal(fresh.url, '');
  assert.equal(fresh.dictionary, null);
  assert.deepEqual(fresh.alternatives, []);
  assert.equal(fresh.createdAt, remote.u, 'a word first seen through synchronisation is dated by its last change');

  const other = fromRecord(local.id, { ...remote, c: 'A different sentence.' }, local);
  assert.equal(other.sentence, 'A different sentence.', 'a genuinely different sentence replaces the local one');
});

test('fields from a newer version of the format survive the round trip', () => {
  const record = { w: 'book', sl: 'en', tl: 'tr', u: T0, r: 1, zz: [1, 2, 3], note: 'future' };
  const local = fromRecord('en|tr|book', record, null);
  assert.deepEqual(local.syncExtra, { zz: [1, 2, 3], note: 'future' });
  assert.deepEqual(toRecord(local), record);
  assert.equal(fromRecord('en|tr|book', { w: 'book', sl: 'en', tl: 'tr', u: T0, r: 1 }, null).syncExtra, undefined);
});

test('tombstones', () => {
  assert.deepEqual(toTombstone({ id: 'en|tr|book', deletedAt: T0, rev: 4 }), { d: T0, r: 4 });
  assert.ok(isTombstone({ d: T0, r: 4 }));
  assert.ok(!isTombstone({ w: 'book', u: T0, r: 1 }));
  assert.ok(!isTombstone({ w: 'book', d: T0, u: T0, r: 1 }), 'a record is a record even with a stray "d"');
  assert.ok(!isTombstone(null) && !isTombstone({}) && !isTombstone({ d: 'yesterday' }));
});

test('documents from outside: nothing stored yet, well-formed, malformed', () => {
  assert.deepEqual(normalizeDocument(null), emptyDocument());
  assert.deepEqual(normalizeDocument(undefined), { v: SCHEMA_VERSION, e: {} });

  const good = { w: 'Book', sl: 'en', tl: 'tr', t: 'kitap', u: T0, r: 2 };
  const raw = {
    v: 1,
    e: {
      'en|tr|book': good,
      'en|tr|gone': { d: T0, r: 3 },
      'en|tr|wrong-id': { w: 'other', sl: 'en', tl: 'tr', u: T0, r: 1 },
      'en|tr|no-time': { w: 'no-time', sl: 'en', tl: 'tr', r: 1 },
      'en|tr|no-rev': { w: 'no-rev', sl: 'en', tl: 'tr', u: T0 },
      'en|tr|bad-rev': { w: 'bad-rev', sl: 'en', tl: 'tr', u: T0, r: 1.5 },
      'en|tr|bad-type': { w: 'bad-type', sl: 'en', tl: 'tr', t: 42, u: T0, r: 1 },
      'en|tr|bad-tomb': { d: T0 },
      'en|tr|string': 'nope',
      'en|tr|array': [1],
      'en|tr|null': null,
    },
  };
  const before = JSON.stringify(raw);
  const document = normalizeDocument(raw);
  assert.deepEqual(document, { v: SCHEMA_VERSION, e: { 'en|tr|book': good, 'en|tr|gone': { d: T0, r: 3 } } });
  assert.equal(JSON.stringify(raw), before, 'the argument is not changed');
});

test('a document that is not a Wordvault document is refused', () => {
  for (const bad of ['text', 42, [], {}, { v: 1 }, { e: {} }, { v: '1', e: {} }, { v: 0, e: {} }, { v: 1, e: [] }]) {
    assert.throws(() => normalizeDocument(bad), (error) => error.code === 'sync_bad_document', JSON.stringify(bad));
  }
});

test('a document from a newer version of the format is refused as a whole, not rewritten', () => {
  const newer = { v: SCHEMA_VERSION + 1, e: { 'en|tr|book': { word: 'book', changed: 'layout' } } };
  assert.throws(() => normalizeDocument(newer), (error) => error.code === 'sync_newer_schema');
});
