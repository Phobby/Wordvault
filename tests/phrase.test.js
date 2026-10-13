// Phrases in the vault: a kind of their own that travels between devices, is not looked up in
// the dictionary and stays out of the quiz unless the user wants it there.

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { updateSettings } from '../src/lib/settings.js';
import { addEntry, getEntry, isPhrase, normalizeEntry } from '../src/lib/vault.js';
import { getDiagnostics } from '../src/quiz/scheduler.js';
import { fromRecord, normalizeDocument, toRecord } from '../src/sync/model.js';
import { createDevice, use } from './helpers/chrome.js';

const phrase = { text: 'once in a blue moon', translation: 'kırk yılda bir', sourceLang: 'en', targetLang: 'tr', kind: 'phrase' };

beforeEach(async () => {
  use(createDevice('device', { uiLanguage: 'en-US' }));
  await updateSettings({ targetLang: 'tr', quizMinCards: 1 });
});

test('a phrase is stored as one; a word carries no kind at all', async () => {
  const stored = await addEntry(phrase);
  assert.equal(stored.kind, 'phrase');
  assert.ok(isPhrase(await getEntry(stored.id)));
  const word = normalizeEntry({ text: 'moon', translation: 'ay', sourceLang: 'en', targetLang: 'tr', kind: 'anything' });
  assert.equal('kind' in word, false);
  assert.equal(isPhrase(word), false);
});

test('the kind travels with the synchronised record and comes back', async () => {
  const stored = await addEntry(phrase);
  const record = toRecord(stored);
  assert.equal(record.k, 'p');
  const document = normalizeDocument({ v: 2, e: { [stored.id]: record } });
  const back = fromRecord(stored.id, document.e[stored.id], null);
  assert.equal(back.kind, 'phrase');
  assert.equal(back.syncExtra, undefined);
  // a word's record has no such key
  const word = await addEntry({ text: 'moon', translation: 'ay', sourceLang: 'en', targetLang: 'tr' });
  assert.equal('k' in toRecord(word), false);
  assert.equal('kind' in fromRecord(word.id, toRecord(word), null), false);
});

test('phrases stay out of the quiz until the setting lets them in', async () => {
  for (const [text, translation] of [['moon', 'ay'], ['sun', 'güneş'], ['star', 'yıldız'], ['sky', 'gökyüzü']]) await addEntry({ text, translation, sourceLang: 'en', targetLang: 'tr' });
  await addEntry(phrase);
  assert.equal((await getDiagnostics()).askable, 4);
  await updateSettings({ quizIncludePhrases: true });
  assert.equal((await getDiagnostics()).askable, 5);
});
