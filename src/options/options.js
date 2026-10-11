// Options page. It edits the same stored settings every other part of the extension reads
// (lib/settings.js); nothing is kept here.

import { getSettings, updateSettings } from '../lib/settings.js';
import { getPreferences, setTargetLanguage } from '../lib/translator.js';

const { h, t, languages } = globalThis.WV;

globalThis.WV.adoptStyles(globalThis.WV.styles.tokens + globalThis.WV.styles.controls);
document.documentElement.lang = languages.uiLanguage();
document.title = t('optionsTitle');

// --- "Saved" indicator ---------------------------------------------------------------------------

const saved = h('span', { class: 'saved', role: 'status', text: t('optSaved') });
let savedTimer = 0;

function flashSaved() {
  saved.classList.add('visible');
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => saved.classList.remove('visible'), 1500);
}

// --- Target language -----------------------------------------------------------------------------

const currentTarget = h('p', { class: 'current' });
const targetList = languages.createList({
  onSelect: async (code) => {
    await setTargetLanguage(code);
    flashSaved();
  },
});

async function renderTarget() {
  const prefs = await getPreferences();
  const name = languages.name(prefs.targetLang);
  currentTarget.textContent = t(prefs.targetChosen ? 'optTargetLangCurrent' : 'optTargetLangUnset', [name]);
  targetList.setOptions({ codes: prefs.languages, value: prefs.targetLang });
}

// --- Double-click trigger ------------------------------------------------------------------------

const doubleClick = h('input', {
  type: 'checkbox',
  onchange: async () => {
    await updateSettings({ doubleClick: doubleClick.checked });
    flashSaved();
  },
});

async function renderSwitches() {
  doubleClick.checked = (await getSettings()).doubleClick;
}

// --- Page ----------------------------------------------------------------------------------------

document.getElementById('app').append(
  h(
    'header',
    { class: 'page-head' },
    h('img', { src: '../icons/icon-48.png', alt: '', width: '32', height: '32' }),
    h('h1', { text: t('optionsTitle') }),
    saved,
  ),
  h(
    'section',
    { class: 'card' },
    h('h2', { text: t('optTargetLang') }),
    h('p', { class: 'help', text: t('optTargetLangHelp') }),
    currentTarget,
    targetList.element,
  ),
  h(
    'section',
    { class: 'card' },
    h(
      'label',
      { class: 'switch' },
      doubleClick,
      h('span', { class: 'switch-text' }, h('strong', { text: t('optDoubleClick') }), h('span', { class: 'help', text: t('optDoubleClickHelp') })),
    ),
  ),
);

function render() {
  renderTarget();
  renderSwitches();
}

render();
// Settings can also change from the translation popup while this page is open.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) render();
});
