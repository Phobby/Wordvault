// The "Voice" part of the quiz settings: the speaking rate, whether remote voices and human
// recordings may be used, and for every language of the vault the voice to use (the best one
// unless the user picks another) with a button to hear it. Which voices there are is this
// device's: the choices are kept on this device only ("speechVoices"), not with the settings
// that travel to the others.

import { disclosure } from './disclosure.js';
import { getSettings, updateSettings } from '../lib/settings.js';
import { listEntries } from '../lib/vault.js';

const { h, t, languages, speech, voices: V } = globalThis.WV;

const VOICES_KEY = 'speechVoices';
/** At most this many voices are offered per language; the rest are worse anyway (a Linux list has hundreds). */
const MAX_OFFERED = 25;
const KIND_KEYS = { enhanced: 'optVoiceKindEnhanced', standard: 'optVoiceKindStandard', robotic: 'optVoiceKindRobotic', 'online-natural': 'optVoiceKindOnlineNatural', online: 'optVoiceKindOnline' };

const primaryOf = (code) => String(code || '').replace(/_/g, '-').toLowerCase().split('-')[0];

/**
 * @param {{ flashSaved: () => void, switchRow: Function, fieldRow: Function }} page  Helpers of the options page.
 * @returns {{ element: HTMLElement, render: () => Promise<void>, describe: () => string }}
 */
export function createVoiceSection({ flashSaved, switchRow, fieldRow }) {
  /** language -> a word of the vault in it, for "Try the voice" */
  let samples = new Map();
  let chosen = {};

  const rateValue = h('span', { class: 'unit', 'aria-hidden': 'true' });
  const rate = h('input', {
    type: 'range',
    min: String(V.RATE.MIN),
    max: String(V.RATE.MAX),
    step: String(V.RATE.STEP),
    'data-setting': 'speechRate',
    'aria-label': t('optVoiceRate'),
    oninput: () => (rateValue.textContent = `${Number(rate.value).toFixed(2)}×`),
    onchange: async () => {
      await updateSettings({ speechRate: V.clampRate(rate.value) });
      flashSaved();
    },
  });
  const toggle = (key) => {
    const input = h('input', {
      type: 'checkbox',
      'data-setting': key,
      onchange: async () => {
        await updateSettings({ [key]: input.checked });
        flashSaved();
        // The engine's options follow the stored settings; give them a moment, then draw again.
        setTimeout(() => renderLanguages(), 50);
      },
    });
    return input;
  };
  const online = toggle('speechOnline');
  const recordings = toggle('speechRecordings');
  const list = h('div', { class: 'fields', id: 'voice-languages' });
  const none = h('p', { class: 'ocr-warning', role: 'status', hidden: true, text: t('optVoiceNone') });

  const install = disclosure([
    h('p', { class: 'help', text: t('optVoiceInstallMac') }),
    h('p', { class: 'help', text: t('optVoiceInstallWindows') }),
    h('p', { class: 'help', text: t('optVoiceInstallLinux') }),
  ], { labelKey: 'optVoiceInstall' });

  const element = h(
    'details',
    { class: 'more', id: 'quiz-voice' },
    h('summary', { text: t('optVoiceTitle') }),
    h('p', { class: 'help', text: t('optVoiceHelp') }),
    h('div', { class: 'fields' }, fieldRow('optVoiceRate', 'optVoiceRateHelp', h('span', { class: 'inline' }, rate, rateValue)), switchRow(online, 'optVoiceOnline', 'optVoiceOnlineHelp'), switchRow(recordings, 'optVoiceRecordings', 'optVoiceRecordingsHelp')),
    h('h4', { text: t('optVoiceLanguages') }),
    none,
    list,
    h('div', { class: 'group-head voice-install' }, install.button),
    install.panel,
  );

  const label = (entry) => `${entry.voice.name} · ${t(KIND_KEYS[entry.kind] || 'optVoiceKindStandard')}`;

  /** The ranked voices of a language, as speech.js would rank them now. */
  function rankedFor(language) {
    const all = globalThis.speechSynthesis ? globalThis.speechSynthesis.getVoices() : [];
    return V.rankVoices(all, language, { regions: V.userRegions(primaryOf(language)), allowOnline: speech.options.allowOnline });
  }

  function languageRow(language) {
    const primary = primaryOf(language);
    const ranked = rankedFor(language);
    const name = languages.name(language) || language;
    const select = h('select', {
      'aria-label': t('optVoiceFor', { language: name }),
      'data-voice-language': primary,
      onchange: async () => {
        chosen = { ...chosen };
        if (select.value) chosen[primary] = select.value;
        else delete chosen[primary];
        await chrome.storage.local.set({ [VOICES_KEY]: chosen });
        flashSaved();
      },
    });
    const offered = ranked.slice(0, MAX_OFFERED);
    const kept = ranked.find((entry) => V.voiceId(entry.voice) === chosen[primary]);
    if (kept && !offered.includes(kept)) offered.push(kept);
    select.append(
      h('option', { value: '', text: ranked[0] ? t('optVoiceAuto', { voice: ranked[0].voice.name }) : t('optVoiceNoneFor') }),
      ...offered.map((entry) => h('option', { value: V.voiceId(entry.voice), text: label(entry) })),
    );
    select.value = kept ? V.voiceId(kept.voice) : '';
    select.disabled = ranked.length === 0;
    const sample = samples.get(language) || name;
    const tryIt = h('button', {
      class: 'wv-btn wv-btn-sm',
      type: 'button',
      'data-action': 'try-voice',
      text: t('optVoiceTry'),
      'aria-label': t('optVoiceTryFor', { language: name }),
      onclick: () => speech.pronounce(sample, language).catch(() => {}),
    });
    tryIt.disabled = ranked.length === 0 && !speech.prefersRecordings();
    const row = h('div', { class: 'field' }, h('div', { class: 'field-text' }, h('strong', { text: name }), h('span', { class: 'help', text: t('optVoiceSample', { word: sample }) })), h('div', { class: 'field-control' }, select, tryIt));
    return { row, found: ranked.length > 0 };
  }

  function renderLanguages() {
    const rows = [...samples.keys()].map(languageRow);
    list.replaceChildren(...rows.map(({ row }) => row));
    if (rows.length === 0) list.replaceChildren(h('p', { class: 'help', text: t('optVoiceNoWords') }));
    // A language without a voice: say how to get one (unless recordings stand in).
    const loaded = !globalThis.speechSynthesis || globalThis.speechSynthesis.getVoices().length > 0;
    none.hidden = !loaded || speech.prefersRecordings() || rows.every(({ found }) => found);
  }

  async function render() {
    const [settings, stored, entries] = await Promise.all([getSettings(), chrome.storage.local.get(VOICES_KEY), listEntries()]);
    chosen = stored[VOICES_KEY] && typeof stored[VOICES_KEY] === 'object' ? stored[VOICES_KEY] : {};
    if (document.activeElement !== rate) rate.value = String(V.clampRate(settings.speechRate));
    rateValue.textContent = `${Number(rate.value).toFixed(2)}×`;
    online.checked = settings.speechOnline === true;
    recordings.checked = settings.speechRecordings === true;
    // The languages of the vault, most words first, each with one of its words to try the voice on.
    const counts = new Map();
    for (const entry of entries) {
      if (!entry.sourceLang || entry.kind === 'phrase') continue;
      const language = primaryOf(entry.sourceLang);
      const known = counts.get(language) || { count: 0, word: entry.text };
      counts.set(language, { count: known.count + 1, word: known.word });
    }
    samples = new Map([...counts.entries()].sort((a, b) => b[1].count - a[1].count).map(([language, { word }]) => [language, word]));
    renderLanguages();
  }

  /** The "Voice" line of "Why is there no quiz?": the voice of the vault's main language, what kind, where it ranks. */
  function describe() {
    const [language] = samples.keys();
    if (!language) return t('optVoiceNoWords');
    const name = languages.name(language) || language;
    if (speech.prefersRecordings()) return t('quizDiagVoiceRecordings', { language: name });
    const found = speech.pickVoice(language);
    if (!found.listed) return t('quizDiagVoiceLoading');
    if (!found.info) return t('quizDiagVoiceNone', { language: name });
    return t('quizDiagVoiceValue', { language: name, voice: found.info.voice.name, kind: t(KIND_KEYS[found.info.kind] || 'optVoiceKindStandard'), local: t(found.info.local ? 'optVoiceLocal' : 'optVoiceRemote'), rank: found.info.rank, of: found.info.of });
  }

  speech.onVoicesChanged(() => renderLanguages());
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[VOICES_KEY]) {
      chosen = changes[VOICES_KEY].newValue || {};
      renderLanguages();
    }
  });

  return { element, render, describe };
}
