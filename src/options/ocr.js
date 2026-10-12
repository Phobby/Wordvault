// The "Scan text on screen" part of the options page: the shortcut and where to change it,
// the languages text is read with, how sure the engine has to be, and two switches.

import { getSettings, updateSettings } from '../lib/settings.js';

const { h, t } = globalThis.WV;

const SCAN_COMMAND = 'scan-screen';
const isFirefox = chrome.runtime.getURL('').startsWith('moz-extension:');
/** Where the browser lets shortcuts be changed. Extension pages may not link there; the address is offered for copying. */
const SHORTCUTS_ADDRESS = 'chrome://extensions/shortcuts';

/**
 * @param {{ flashSaved: () => void, switchRow: Function, fieldRow: Function }} page  Helpers of the options page.
 * @returns {{ element: HTMLElement, render: () => Promise<void> }}
 */
export function createOcrSection({ flashSaved, switchRow, fieldRow }) {
  const save = async (patch) => {
    await updateSettings(patch);
    flashSaved();
  };

  const shortcut = h('strong', { class: 'ocr-shortcut' });
  const address = h('input', { type: 'text', readonly: true, value: SHORTCUTS_ADDRESS, class: 'ocr-address', 'aria-label': t('optOcrShortcutAddress'), onfocus: () => address.select() });
  const copy = h('button', {
    class: 'wv-btn wv-btn-sm',
    type: 'button',
    text: t('optOcrCopy'),
    onclick: async () => {
      try {
        await navigator.clipboard.writeText(SHORTCUTS_ADDRESS);
      } catch {
        address.select(); // the user can still copy it by hand
        return;
      }
      copy.textContent = t('optOcrCopied');
      setTimeout(() => (copy.textContent = t('optOcrCopy')), 1500);
    },
  });

  const language = h(
    'select',
    { onchange: () => save({ ocrLanguages: language.value }) },
    h('option', { value: 'auto', text: t('optOcrLangAuto') }),
    h('option', { value: 'en', text: globalThis.WV.languages.name('en') }),
    h('option', { value: 'tr', text: globalThis.WV.languages.name('tr') }),
  );
  const confidence = h('input', {
    type: 'number',
    min: '0',
    max: '95',
    step: '5',
    onchange: () => {
      const value = Math.max(0, Math.min(95, Math.round(Number(confidence.value) || 0)));
      confidence.value = String(value);
      save({ ocrMinConfidence: value });
    },
  });
  const showBoxes = h('input', { type: 'checkbox', onchange: () => save({ ocrShowBoxes: showBoxes.checked }) });
  const remember = h('input', { type: 'checkbox', onchange: () => save({ ocrRememberArea: remember.checked }) });

  const element = h(
    'section',
    { class: 'card', id: 'ocr' },
    h('h2', { text: t('optOcrTitle') }),
    h('p', { class: 'help', text: t('optOcrHelp') }),
    fieldRow('optOcrShortcut', isFirefox ? 'optOcrShortcutHelpFirefox' : 'optOcrShortcutHelpChrome', shortcut),
    // Chrome does not let a page open its shortcut settings, so the address is given as text.
    isFirefox ? '' : h('div', { class: 'ocr-address-row' }, address, copy),
    fieldRow('optOcrLang', 'optOcrLangHelp', language),
    fieldRow('optOcrConfidence', 'optOcrConfidenceHelp', confidence),
    switchRow(showBoxes, 'optOcrShowBoxes', 'optOcrShowBoxesHelp'),
    switchRow(remember, 'optOcrRemember', 'optOcrRememberHelp'),
    h('p', { class: 'help', text: t('optOcrEngine') }),
  );

  async function render() {
    const settings = await getSettings();
    if (document.activeElement !== language) language.value = ['auto', 'en', 'tr'].includes(settings.ocrLanguages) ? settings.ocrLanguages : 'auto';
    if (document.activeElement !== confidence) confidence.value = String(settings.ocrMinConfidence);
    showBoxes.checked = settings.ocrShowBoxes === true;
    remember.checked = settings.ocrRememberArea === true;
    try {
      const command = (await chrome.commands.getAll()).find((candidate) => candidate.name === SCAN_COMMAND);
      shortcut.textContent = command?.shortcut || t('optOcrShortcutNone');
      shortcut.classList.toggle('missing', !command?.shortcut);
    } catch {
      shortcut.textContent = '';
    }
  }

  return { element, render };
}
