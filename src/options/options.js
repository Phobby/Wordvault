// Options page. It edits the same stored settings every other part of the extension reads
// (lib/settings.js); nothing is kept here.

import { downloadBackup, restoreBackup } from '../lib/backup.js';
import { getSettings, updateSettings } from '../lib/settings.js';
import { getPreferences, setTargetLanguage } from '../lib/translator.js';

const { h, t, languages, speech } = globalThis.WV;

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

const ttsFallback = h('input', {
  type: 'checkbox',
  onchange: async () => {
    await updateSettings({ ttsFallback: ttsFallback.checked });
    flashSaved();
  },
});

async function renderSwitches() {
  const settings = await getSettings();
  doubleClick.checked = settings.doubleClick;
  ttsFallback.checked = settings.ttsFallback;
}

function switchRow(input, titleKey, helpKey) {
  return h(
    'label',
    { class: 'switch' },
    input,
    h('span', { class: 'switch-text' }, h('strong', { text: t(titleKey) }), h('span', { class: 'help', text: t(helpKey) })),
  );
}

// --- Backup --------------------------------------------------------------------------------------

/** Larger than any real vault; keeps a wrong file from being read into memory. */
const MAX_BACKUP_BYTES = 50 * 1024 * 1024;

const backupStatus = h('p', { class: 'help', role: 'status' });
const filePicker = h('input', {
  type: 'file',
  accept: 'application/json,.json',
  hidden: true,
  onchange: async () => {
    const [file] = filePicker.files;
    filePicker.value = ''; // so picking the same file again fires "change"
    if (!file) return;
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error('too large');
      const { added, skipped, invalid } = await restoreBackup(await file.text());
      backupStatus.textContent = t('bkImported', [String(added), String(skipped), String(invalid)]);
    } catch {
      backupStatus.textContent = t('bkBadFile');
    }
  },
});
const backupSection = h(
  'section',
  { class: 'card', id: 'backup' },
  h('h2', { text: t('bkTitle') }),
  h('p', { class: 'help', text: t('bkHelp') }),
  h(
    'div',
    { class: 'buttons' },
    h('button', {
      class: 'wv-btn',
      type: 'button',
      text: t('tbExport'),
      onclick: async () => {
        backupStatus.textContent = t('bkExported', [String(await downloadBackup())]);
      },
    }),
    h('button', { class: 'wv-btn', type: 'button', text: t('tbImport'), onclick: () => filePicker.click() }),
    filePicker,
  ),
  backupStatus,
);

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
  h('section', { class: 'card' }, switchRow(doubleClick, 'optDoubleClick', 'optDoubleClickHelp')),
  // Only meaningful in the browsers where recordings replace the browser's voice.
  speech.usesRecordings && h('section', { class: 'card' }, switchRow(ttsFallback, 'optTtsFallback', 'optTtsFallbackHelp')),
  backupSection,
);

// The toolbar popup links here for importing.
if (location.hash === '#backup') {
  backupSection.classList.add('highlight');
  backupSection.scrollIntoView({ block: 'center' });
}

function render() {
  renderTarget();
  renderSwitches();
}

render();
// Settings can also change from the translation popup while this page is open.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) render();
});
