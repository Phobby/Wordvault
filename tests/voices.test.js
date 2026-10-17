// Choosing and using a voice (shared/voices.js, shared/speech.js): the ranking rule with voice
// lists like the ones browsers report, the language of every utterance, the rates, a list that
// arrives late, and a chosen voice that is kept.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { beforeEach, test } from 'node:test';
import vm from 'node:vm';

import { createDevice, use } from './helpers/chrome.js';

const VOICES_SRC = readFileSync(new URL('../src/shared/voices.js', import.meta.url), 'utf8');
const SPEECH_SRC = readFileSync(new URL('../src/shared/speech.js', import.meta.url), 'utf8');

/** A context with the two files loaded, a fake speech engine and the device's storage. */
function load({ voices = [], languages = ['tr-TR', 'en-US'], userAgent = 'Mozilla/5.0 Chrome/140', platform = 'Linux x86_64' } = {}) {
  const spoken = [];
  const listeners = [];
  const engine = {
    list: voices,
    speaking: false,
    pending: false,
    paused: false,
    getVoices: () => engine.list,
    speak(utterance) {
      spoken.push(utterance);
    },
    cancel() {},
    resume() {},
    addEventListener: (type, callback) => type === 'voiceschanged' && listeners.push(callback),
  };
  class Utterance {
    constructor(text) {
      this.text = text;
      this.listeners = {};
    }
    addEventListener(type, callback) {
      this.listeners[type] = callback;
    }
  }
  const context = { console, setTimeout, clearTimeout, Date, Math, Number, String, Object, Array, Set, Map, Promise, JSON, RegExp, Error };
  context.globalThis = context;
  context.window = context;
  context.navigator = { languages, userAgent, platform };
  context.speechSynthesis = engine;
  context.SpeechSynthesisUtterance = Utterance;
  context.chrome = globalThis.chrome;
  context.WV = { send: async () => null };
  vm.createContext(context);
  vm.runInContext(VOICES_SRC, context);
  vm.runInContext(SPEECH_SRC, context);
  return { WV: context.WV, engine, spoken, voicesChanged: () => listeners.forEach((callback) => callback()) };
}

const voice = (name, lang, extra = {}) => ({ name, lang, voiceURI: name, localService: true, default: false, ...extra });
/** Names, as an array of this realm (the context's arrays have another prototype). */
const names = (ranked) => Array.from(ranked, (entry) => entry.voice.name);

let V;
beforeEach(() => {
  use(createDevice('device'));
  ({ WV: { voices: V } } = load());
});

// --- the ranking rule ----------------------------------------------------------------------------

test('macOS-like list: enhanced first, robotic last, novelty never', () => {
  const list = [
    voice('Albert', 'en-US', { default: true }),
    voice('Fred', 'en-US'),
    voice('Eddy (English (US))', 'en-US', { voiceURI: 'com.apple.eloquence.en-US.Eddy' }),
    voice('Samantha', 'en-US'),
    voice('Zoe (Premium)', 'en-US', { voiceURI: 'com.apple.voice.premium.en-US.Zoe' }),
    voice('Daniel', 'en-GB'),
    voice('Thomas', 'fr-FR'),
  ];
  assert.deepEqual(names(V.rankVoices(list, 'en')), ['Zoe (Premium)', 'Samantha', 'Daniel', 'Eddy (English (US))', 'Fred']);
});

test('the region: the one asked for, then the user\'s, then the usual one; a robotic voice never beats a natural one', () => {
  const list = [voice('US voice', 'en-US'), voice('GB voice', 'en-GB'), voice('AU voice', 'en-AU'), voice('Fred', 'en-GB')];
  assert.deepEqual(names(V.rankVoices(list, 'en-GB')).slice(0, 2), ['GB voice', 'US voice']);
  assert.deepEqual(names(V.rankVoices(list, 'en', { regions: ['au'] }))[0], 'AU voice');
  assert.deepEqual(names(V.rankVoices(list, 'en'))[0], 'US voice');
  assert.equal(names(V.rankVoices(list, 'en-GB')).at(-1), 'Fred', 'robotic en-GB after natural voices of other regions');
});

test('online voices only when allowed; then a natural one before a local standard one', () => {
  const list = [
    voice('Microsoft David - English (United States)', 'en-US'),
    voice('Google US English', 'en-US', { localService: false }),
    voice('Microsoft Aria Online (Natural) - English (United States)', 'en-US', { localService: false }),
    { name: '', lang: '', localService: false }, // an incomplete entry, as Edge sometimes reports
  ];
  assert.deepEqual(names(V.rankVoices(list, 'en')), ['Microsoft David - English (United States)']);
  assert.deepEqual(names(V.rankVoices(list, 'en', { allowOnline: true })), ['Microsoft Aria Online (Natural) - English (United States)', 'Microsoft David - English (United States)', 'Google US English']);
});

test('Linux Firefox list: speech-dispatcher voices count as local; the plain eSpeak voice before its variants, odd ones last', () => {
  const speechd = (name, lang) => voice(name, lang, { localService: false, voiceURI: `urn:moz-tts:speechd:${encodeURIComponent(name)}?${lang}` });
  const list = [speechd('English (America, New York City)', 'en-US-NYC'), speechd('English (America)+klatt4', 'en-US'), speechd('English (America)+Andy', 'en-US'), speechd('English (America)', 'en-US'), speechd('English (America)+anikaRobot', 'en-US'), speechd('Turkish+Lee', 'tr')];
  const ranked = V.rankVoices(list, 'en');
  assert.equal(ranked.length, 5, 'none of them is dropped as remote');
  assert.ok(names(ranked).indexOf('English (America, New York City)') > 0, 'a dialect after the standard voice of its region');
  assert.equal(names(ranked)[0], 'English (America)');
  assert.deepEqual(names(ranked).slice(-2).sort(), ['English (America)+anikaRobot', 'English (America)+klatt4']);
  assert.equal(ranked[0].kind, 'robotic');
  assert.equal(V.rankVoices(list, 'tr').length, 1);
});

test('no voice for a language, and languages filed under other codes', () => {
  assert.equal(V.rankVoices([], 'en').length, 0);
  assert.equal(V.pick([voice('Thomas', 'fr-FR')], 'de'), null);
  assert.equal(V.pick([voice('Nora', 'nb-NO')], 'no').voice.name, 'Nora');
  assert.equal(V.pick([voice('Carmit', 'iw-IL')], 'he').voice.name, 'Carmit');
  assert.equal(V.pick([voice('Ana', 'pt_BR')], 'pt-BR').voice.name, 'Ana', 'Android writes an underscore');
});

test('a chosen voice is used while it is there; otherwise the best', () => {
  const list = [voice('Zoe (Premium)', 'en-US', { voiceURI: 'z' }), voice('Samantha', 'en-US', { voiceURI: 's' })];
  assert.equal(V.pick(list, 'en', { chosen: 's' }).voice.name, 'Samantha');
  assert.deepEqual([V.pick(list, 'en', { chosen: 's' }).rank, V.pick(list, 'en', { chosen: 's' }).of], [2, 2]);
  assert.equal(V.pick(list, 'en', { chosen: 'gone' }).voice.name, 'Zoe (Premium)');
});

test('rates: a little slower by default, slower for "slow", within the range', () => {
  assert.equal(V.RATE.DEFAULT, 0.9);
  assert.equal(V.RATE.SLOW, 0.7);
  assert.ok(V.RATE.SLOW < V.RATE.DEFAULT && V.RATE.DEFAULT < 1);
  assert.equal(V.clampRate(3), V.RATE.MAX);
  assert.equal(V.clampRate(0.1), V.RATE.MIN);
  assert.equal(V.clampRate('x'), V.RATE.DEFAULT);
});

// --- speech.js with them ---------------------------------------------------------------------------

test('every utterance is new, in the word\'s language, at the rate asked for', async () => {
  const { WV, spoken } = load({ voices: [voice('Daniel', 'en-GB'), voice('Thomas', 'fr-FR')] });
  WV.speech.speak('book', 'en');
  assert.equal(spoken.length, 1);
  assert.equal(spoken[0].voice.name, 'Daniel');
  assert.equal(spoken[0].lang, 'en-GB');
  assert.equal(spoken[0].rate, 0.9);
  spoken[0].listeners.end();
  WV.speech.speak('book', 'en', { rate: 0.7 });
  assert.equal(spoken[1].rate, 0.7);
  assert.notEqual(spoken[1], spoken[0], 'never the same utterance twice');
  spoken[1].listeners.end();
  WV.speech.speak('Buch', 'de');
  assert.equal(spoken[2].voice, undefined, 'no German voice');
  assert.equal(spoken[2].lang, 'de', 'the language is still said');
});

test('the stored rate and chosen voice are followed; a remote voice only once allowed', async () => {
  await chrome.storage.local.set({ settings: { speechRate: 0.75 }, speechVoices: { en: 'samantha-uri' } });
  const { WV, spoken } = load({ voices: [voice('Zoe (Premium)', 'en-US'), voice('Samantha', 'en-US', { voiceURI: 'samantha-uri' }), voice('Google UK English', 'en-GB', { localService: false })] });
  await new Promise((resolve) => setTimeout(resolve, 10));
  WV.speech.speak('book', 'en');
  assert.equal(spoken[0].rate, 0.75);
  assert.equal(spoken[0].voice.name, 'Samantha');
  assert.equal(WV.speech.pickVoice('en-GB').voice.name, 'Samantha', 'the choice holds for every region of the language; the remote GB voice is not taken');
  await chrome.storage.local.set({ settings: { speechRate: 0.75, speechOnline: true }, speechVoices: {} });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(WV.speech.options.allowOnline, true);
});

test('a voice list that arrives late: "not loaded yet" until voiceschanged, then the voice', () => {
  const { WV, engine, voicesChanged } = load({ voices: [] });
  let told = 0;
  WV.speech.onVoicesChanged(() => (told += 1));
  assert.equal(WV.speech.pickVoice('en').listed, false);
  assert.equal(WV.speech.canSpeak('en'), true, 'an empty list is not believed yet');
  engine.list = [voice('Samantha', 'en-US')];
  voicesChanged();
  assert.equal(told, 1);
  assert.equal(WV.speech.pickVoice('en').voice.name, 'Samantha');
  assert.equal(WV.speech.canSpeak('de'), false, 'a loaded list without the language is believed');
});
