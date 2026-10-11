// Choosing the right recording among the audio files of a dictionary page.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { pickRecording } from '../src/lib/pronunciation.js';

const file = (title, size = 12_000, mime = 'application/ogg') => ({ title, size, mime, url: `https://upload.wikimedia.org/x/${encodeURIComponent(title)}` });
const GIFT = [file('File:en-us-gift.ogg'), file('File:Sv-gift.ogg'), file('File:Nl-gift.ogg'), file('File:LL-Q1860 (eng)-Back ache-gift.wav', 68_000, 'audio/wav'), file('File:De-Gift.ogg'), file('File:Commons-logo.svg', 900, 'image/svg+xml')];
const BOOK = [file('File:En-uk-book.ogg'), file('File:LL-Q150 (fra)-Poslovitch-book.wav', 83_000, 'audio/wav'), file('File:en-us-book.ogg'), file('File:en-au-book.ogg')];

test('the recording has to be of this word in this language', () => {
  assert.equal(pickRecording(GIFT, 'gift', 'en').title, 'File:en-us-gift.ogg');
  assert.equal(pickRecording(GIFT, 'Gift', 'de').title, 'File:De-Gift.ogg');
  assert.equal(pickRecording(GIFT, 'gift', 'sv').title, 'File:Sv-gift.ogg');
  assert.equal(pickRecording(GIFT, 'gift', 'fr'), null, 'not recorded in French');
  assert.equal(pickRecording(GIFT, 'gifts', 'en'), null, 'a different word');
  assert.equal(pickRecording(GIFT, 'gift', ''), null, 'language unknown');
});

test('regional recordings: the conventional one first, any other as a fallback', () => {
  assert.equal(pickRecording(BOOK, 'book', 'en').title, 'File:en-us-book.ogg');
  assert.equal(pickRecording(BOOK, 'book', 'en-AU').title, 'File:en-au-book.ogg');
  assert.match(pickRecording(BOOK, 'book', 'en-NZ').title, /^File:[Ee]n-(us|uk|au)-book\.ogg$/);
});

test('both naming schemes on Commons are understood', () => {
  assert.equal(pickRecording(BOOK, 'book', 'fr').title, 'File:LL-Q150 (fra)-Poslovitch-book.wav');
  assert.equal(pickRecording([file('File:LL-Q256 (tur)-ToprakM-kelebek.wav', 91_000, 'audio/wav')], 'kelebek', 'tr').title, 'File:LL-Q256 (tur)-ToprakM-kelebek.wav');
  assert.equal(pickRecording(GIFT.filter((f) => !f.title.startsWith('File:en-us')), 'gift', 'en').title, 'File:LL-Q1860 (eng)-Back ache-gift.wav');
  assert.equal(pickRecording([file('File:En-us-ice cream.ogg')], 'ice  cream', 'en').title, 'File:En-us-ice cream.ogg');
  assert.equal(pickRecording([file('File:En-us-ice_cream.ogg')], 'ice cream', 'en').title, 'File:En-us-ice_cream.ogg');
});

test('files that cannot be a word recording are ignored', () => {
  assert.equal(pickRecording([file('File:en-us-book.ogg', 5_000_000)], 'book', 'en'), null, 'too large');
  assert.equal(pickRecording([file('File:en-us-book.pdf')], 'book', 'en'), null, 'not audio');
  assert.equal(pickRecording([file('File:en-us-book.ogg', 0)], 'book', 'en'), null, 'empty');
  assert.equal(pickRecording([], 'book', 'en'), null);
});
