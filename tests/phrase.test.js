// Phrases in the vault: a kind of their own that travels between devices, is not looked up in
// the dictionary and never goes into the quiz.

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { updateSettings } from '../src/lib/settings.js';
import { addEntry, getEntry, isPhrase, listEntries, normalizeEntry } from '../src/lib/vault.js';
import { askableCards } from '../src/quiz/question.js';
import { getDiagnostics, startManualQuiz } from '../src/quiz/scheduler.js';
import { readSession } from '../src/quiz/session.js';
import { fromRecord, normalizeDocument, toRecord } from '../src/sync/model.js';
import { createDevice, use } from './helpers/chrome.js';

const phrase = { text: 'once in a blue moon', translation: 'kırk yılda bir', sourceLang: 'en', targetLang: 'tr', kind: 'phrase' };

beforeEach(async () => {
  use(createDevice('device', { uiLanguage: 'en-US' }));
  await updateSettings({ targetLang: 'tr' });
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

test('phrases never go into the quiz, whatever an old setting says and however the quiz is started', async () => {
  for (const [text, translation] of [['moon', 'ay'], ['sun', 'güneş'], ['star', 'yıldız'], ['sky', 'gökyüzü']]) await addEntry({ text, translation, sourceLang: 'en', targetLang: 'tr' });
  const kept = await addEntry(phrase);
  assert.equal((await getDiagnostics()).askable, 4);
  // the switch of earlier versions, still stored: it no longer lets them in
  await chrome.storage.local.set({ settings: { ...(await chrome.storage.local.get('settings')).settings, quizIncludePhrases: true } });
  assert.equal((await getDiagnostics()).askable, 4);
  const all = [...(await listEntries())];
  assert.ok(!askableCards(all, 'tr').some((card) => card.id === kept.id), 'askableCards leaves it out by itself');
  for (const mode of ['classic', 'writing', 'listening', 'expert']) {
    for (let round = 0; round < 6; round++) {
      const started = await startManualQuiz({ mode });
      if (started.ok) assert.notEqual((await readSession()).question.id, kept.id, mode);
    }
  }
});
