// Properties of the merge: whatever order devices synchronise in, they end up with the same
// document, and nothing either side had is lost.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { canonical, compareVersions, documentsEqual, mergeDocuments, purgeTombstones, serializeDocument } from '../src/sync/merge.js';
import { SCHEMA_VERSION, TOMBSTONE_TTL_MS, isTombstone } from '../src/sync/model.js';
import { createRandom } from './helpers/random.js';

const T0 = 1_790_000_000_000;
const WORDS = ['apple', 'book', 'cloud', 'door', 'eagle', 'forest', 'garden', 'house', 'island', 'jacket'];
const idOf = (word) => `en|tr|${word}`;

/** A random document over a small set of words, with few distinct revisions and times so that
 *  ties (same revision, same time, different content) actually happen. */
function randomDocument(random) {
  const e = {};
  for (const word of WORDS) {
    const roll = random.next();
    if (roll < 0.3) continue;
    const r = random.int(1, 3);
    const time = T0 + random.int(0, 2);
    if (roll < 0.5) e[idOf(word)] = { d: time, r };
    else e[idOf(word)] = { w: word, sl: 'en', tl: 'tr', t: random.pick(['bir', 'iki', 'üç']), u: time, r, ...(random.next() < 0.3 ? { b: random.int(1, 4) } : {}) };
  }
  return { v: SCHEMA_VERSION, e };
}

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

const text = serializeDocument;

test('merge is commutative, associative and idempotent (2000 random document triples)', () => {
  const random = createRandom(20261011);
  for (let round = 0; round < 2000; round++) {
    const a = deepFreeze(randomDocument(random));
    const b = deepFreeze(randomDocument(random));
    const c = deepFreeze(randomDocument(random));
    const ab = mergeDocuments(a, b);

    assert.equal(text(ab), text(mergeDocuments(b, a)), 'commutative');
    assert.equal(text(mergeDocuments(ab, c)), text(mergeDocuments(a, mergeDocuments(b, c))), 'associative');
    assert.equal(text(mergeDocuments(a, a)), text(a), 'idempotent');
    assert.equal(text(mergeDocuments(ab, b)), text(ab), 'merging something again changes nothing');
    assert.equal(text(mergeDocuments(ab, a)), text(ab), 'merging something again changes nothing');
    assert.equal(text(mergeDocuments(a, { v: SCHEMA_VERSION, e: {} })), text(a), 'empty document is neutral');
  }
});

test('merge loses nothing and keeps the newest version of every word', () => {
  const random = createRandom(7);
  for (let round = 0; round < 1000; round++) {
    const a = randomDocument(random);
    const b = randomDocument(random);
    const merged = mergeDocuments(a, b);
    assert.deepEqual(Object.keys(merged.e).sort(), [...new Set([...Object.keys(a.e), ...Object.keys(b.e)])].sort(), 'every id of either side is present');
    for (const [id, value] of Object.entries(merged.e)) {
      for (const side of [a, b]) {
        if (side.e[id]) assert.ok(compareVersions(value, side.e[id]) >= 0, 'nothing newer was dropped');
      }
      assert.ok([a.e[id], b.e[id]].some((candidate) => candidate && canonical(candidate) === canonical(value)), 'the result is one of the inputs, unchanged');
    }
  }
});

test('any number of devices, merged in any order, agree', () => {
  const random = createRandom(99);
  for (let round = 0; round < 200; round++) {
    const devices = Array.from({ length: 5 }, () => randomDocument(random));
    const expected = text(devices.reduce(mergeDocuments));
    for (let attempt = 0; attempt < 6; attempt++) {
      // a different order, and some documents merged more than once
      const order = random.shuffle([...devices, random.pick(devices), random.pick(devices)]);
      assert.equal(text(order.reduce(mergeDocuments)), expected);
    }
  }
});

test('version order: revision, then time, then removal, then content', () => {
  const record = (fields) => ({ w: 'book', sl: 'en', tl: 'tr', t: 'kitap', u: T0, r: 1, ...fields });

  // A later revision wins even if its clock is far behind: the edit was made knowing the other.
  assert.ok(compareVersions(record({ r: 2, u: T0 - 86_400_000 }), record({ r: 1, u: T0 + 86_400_000 })) > 0);
  assert.ok(compareVersions({ d: T0 - 86_400_000, r: 2 }, record({ r: 1, u: T0 + 86_400_000 })) > 0, 'a removal made after seeing the word beats it despite a slow clock');
  assert.ok(compareVersions(record({ r: 3, u: T0 }), { d: T0 + 5, r: 2 }) > 0, 'adding the word again after a removal brings it back');

  // Independent edits (same revision): the later one wins.
  assert.ok(compareVersions(record({ r: 2, u: T0 + 1, t: 'defter' }), record({ r: 2, u: T0 })) > 0);
  assert.ok(compareVersions({ d: T0 + 1, r: 2 }, record({ r: 2, u: T0 })) > 0);
  assert.ok(compareVersions(record({ r: 2, u: T0 + 1 }), { d: T0, r: 2 }) > 0);

  // Exact tie on revision and time: the removal wins.
  assert.ok(compareVersions({ d: T0, r: 2 }, record({ r: 2, u: T0 })) > 0);

  // Exact tie between two different records: decided by content, the same way on every device.
  const x = record({ r: 2, t: 'kitap' });
  const y = record({ r: 2, t: 'defter' });
  assert.notEqual(compareVersions(x, y), 0);
  assert.equal(Math.sign(compareVersions(x, y)), -Math.sign(compareVersions(y, x)));
  assert.equal(text(mergeDocuments({ v: 1, e: { 'en|tr|book': x } }, { v: 1, e: { 'en|tr|book': y } })), text(mergeDocuments({ v: 1, e: { 'en|tr|book': y } }, { v: 1, e: { 'en|tr|book': x } })));

  // Same content, key order irrelevant.
  assert.equal(compareVersions({ r: 1, u: T0, w: 'book', sl: 'en', tl: 'tr' }, { w: 'book', tl: 'tr', sl: 'en', u: T0, r: 1 }), 0);
});

test('a clock that runs ahead does not win forever', () => {
  const id = 'en|tr|book';
  // Device A's clock is a year ahead when it saves the word.
  const fromA = { v: 1, e: { [id]: { w: 'book', sl: 'en', tl: 'tr', t: 'kitab', u: T0 + 365 * 86_400_000, r: 1 } } };
  // Device B synchronises, sees revision 1 and corrects the translation at the real time.
  const fromB = { v: 1, e: { [id]: { w: 'book', sl: 'en', tl: 'tr', t: 'kitap', u: T0, r: 2 } } };
  assert.equal(mergeDocuments(fromA, fromB).e[id].t, 'kitap');
  assert.equal(mergeDocuments(fromB, fromA).e[id].t, 'kitap');
});

test('merge does not change its arguments and returns entries in a stable order', () => {
  const a = deepFreeze({ v: 1, e: { 'en|tr|zebra': { w: 'zebra', sl: 'en', tl: 'tr', u: T0, r: 1 }, 'en|tr|apple': { d: T0, r: 2 } } });
  const b = deepFreeze({ v: 1, e: { 'en|tr|mango': { w: 'mango', sl: 'en', tl: 'tr', u: T0, r: 1 } } });
  const merged = mergeDocuments(a, b);
  assert.deepEqual(Object.keys(merged.e), ['en|tr|apple', 'en|tr|mango', 'en|tr|zebra']);
  assert.equal(merged.v, SCHEMA_VERSION);
  assert.ok(documentsEqual(merged, { v: 1, e: { ...b.e, ...a.e } }));
});

test('fields this version does not know travel through a merge untouched', () => {
  const id = 'en|tr|book';
  const future = { w: 'book', sl: 'en', tl: 'tr', t: 'kitap', u: T0 + 10, r: 2, zz: { note: 'from a newer version' } };
  const merged = mergeDocuments({ v: 1, e: { [id]: { w: 'book', sl: 'en', tl: 'tr', u: T0, r: 1 } } }, { v: 1, e: { [id]: future } });
  assert.deepEqual(merged.e[id], future);
});

test('tombstones are dropped 90 days after the removal, and only then', () => {
  const now = T0 + 200 * 86_400_000;
  const document = {
    v: 1,
    e: {
      'en|tr|old': { d: now - TOMBSTONE_TTL_MS - 1, r: 2 },
      'en|tr|edge': { d: now - TOMBSTONE_TTL_MS, r: 2 },
      'en|tr|recent': { d: now - TOMBSTONE_TTL_MS + 1, r: 2 },
      'en|tr|yesterday': { d: now - 86_400_000, r: 2 },
      'en|tr|ancient-word': { w: 'ancient-word', sl: 'en', tl: 'tr', u: T0 - 400 * 86_400_000, r: 1 },
    },
  };
  const purged = purgeTombstones(document, now);
  assert.deepEqual(Object.keys(purged.e), ['en|tr|ancient-word', 'en|tr|recent', 'en|tr|yesterday'], 'old words stay; only old removals go');
  assert.ok(isTombstone(purged.e['en|tr|recent']));
  assert.equal(text(purgeTombstones(purged, now)), text(purged), 'purging twice changes nothing');
  assert.equal(Object.keys(document.e).length, 5, 'the argument is not changed');
  assert.equal(TOMBSTONE_TTL_MS, 90 * 24 * 60 * 60 * 1000);
});
