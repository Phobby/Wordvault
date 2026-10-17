// The "Screen translation" group of the translation section: the shortcut and where to change
// it, and two switches. The language is always found by itself and the engine's confidence is fixed
// (features/screen-ocr/scan.js); neither is a setting.

import { disclosure } from './disclosure.js';
import { getSettings, updateSettings } from '../lib/settings.js';

const { h, t } = globalThis.WV;

const SCAN_COMMAND = 'scan-screen';
const isFirefox = chrome.runtime.getURL('').startsWith('moz-extension:');
/** Where the browser lets shortcuts be changed. Extension pages may not link there; the address is offered for copying. */
const SHORTCUTS_ADDRESS = isFirefox ? 'about:addons' : 'chrome://extensions/shortcuts';
const isMac = /mac/i.test(navigator.userAgentData?.platform || navigator.platform || '');
/** The Option key, as the browsers write it in a shortcut ("⌥⇧S", "Alt+Shift+S"). */
const OPTION_KEY = /⌥|Alt|Option/i;

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
  const warning = h('p', { class: 'ocr-warning', role: 'status', hidden: true });
  // Firefox can open its shortcut page for us (commands.openShortcutSettings, Firefox 137+).
  const openSettings =
    typeof chrome.commands?.openShortcutSettings === 'function'
      ? h('button', { class: 'wv-btn wv-btn-sm', type: 'button', text: t('optOcrShortcutOpen'), onclick: () => chrome.commands.openShortcutSettings().catch(() => {}) })
      : '';
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

  const showBoxes = h('input', { type: 'checkbox', onchange: () => save({ ocrShowBoxes: showBoxes.checked }) });
  const remember = h('input', { type: 'checkbox', onchange: () => save({ ocrRememberArea: remember.checked }) });

  // How to change the shortcut, folded under the row, as in "Translation settings" (options/passage.js).
  const shortcutDetails = disclosure([
    h('p', { class: 'help', text: t(isFirefox ? 'optOcrShortcutHelpFirefox' : 'optOcrShortcutHelpChrome') }),
    // A page may not open the browser's shortcut settings by a link, so the address is given as text.
    h('div', { class: 'ocr-address-row' }, address, copy),
  ]);

  const element = h(
    'div',
    { class: 'group', id: 'ocr' },
    h('h3', { text: t('optOcrTitle') }),
    h('p', { class: 'help', text: t('optOcrHelp') }),
    h(
      'div',
      { class: 'fields' },
      fieldRow('optOcrShortcut', null, shortcut, openSettings, shortcutDetails.button),
      warning,
      shortcutDetails.panel,
      switchRow(remember, 'optOcrRemember', 'optOcrRememberHelp'),
      switchRow(showBoxes, 'optOcrShowBoxes', 'optOcrShowBoxesHelp'),
    ),
  );

  async function render() {
    const settings = await getSettings();
    showBoxes.checked = settings.ocrShowBoxes === true;
    remember.checked = settings.ocrRememberArea === true;
    try {
      const command = (await chrome.commands.getAll()).find((candidate) => candidate.name === SCAN_COMMAND);
      const assigned = command?.shortcut || '';
      shortcut.textContent = assigned || t('optOcrShortcutNone');
      shortcut.classList.toggle('missing', !assigned);
      // Not assigned, or assigned to something that does not work on this system: say so.
      const problem = !assigned ? 'optOcrShortcutWarnNone' : isMac && OPTION_KEY.test(assigned) ? 'optOcrShortcutWarnOption' : '';
      warning.hidden = !problem;
      warning.textContent = problem ? t(problem) : '';
    } catch {
      shortcut.textContent = '';
    }
  }

  return { element, render };
}
