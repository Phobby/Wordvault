// The "Translation settings" group: the rows the page puts first (the target language, double
// click), then how a selection is translated: the right-click menu item, the button next to a
// selection, and the keyboard shortcut and where to change it.

import { disclosure } from './disclosure.js';
import { PASSAGE_MAX_CHARS } from '../lib/passage.js';
import { getSettings, updateSettings } from '../lib/settings.js';

const { h, t } = globalThis.WV;

const TRANSLATE_COMMAND = 'translate-selection';
const isFirefox = chrome.runtime.getURL('').startsWith('moz-extension:');
/** Where the browser lets shortcuts be changed. Extension pages may not link there; the address is offered for copying. */
const SHORTCUTS_ADDRESS = isFirefox ? 'about:addons' : 'chrome://extensions/shortcuts';
const isMac = /mac/i.test(navigator.userAgentData?.platform || navigator.platform || '');
/** The Option key, as the browsers write it in a shortcut ("⌥⇧S", "Alt+Shift+S"). */
const OPTION_KEY = /⌥|Alt|Option/i;

/**
 * @param {{ flashSaved: () => void, switchRow: Function, fieldRow: Function, leadRows?: Array<Node | string> }} page
 *        Helpers of the options page; leadRows: rows of its own that open the group.
 * @returns {{ element: HTMLElement, render: () => Promise<void> }}
 */
export function createPassageSection({ flashSaved, switchRow, fieldRow, leadRows = [] }) {
  const toggle = (key) => {
    const input = h('input', {
      type: 'checkbox',
      'data-setting': key,
      onchange: async () => {
        await updateSettings({ [key]: input.checked });
        flashSaved();
      },
    });
    return input;
  };
  const menu = toggle('contextMenuTranslate');
  const button = toggle('selectionButton');

  const shortcut = h('strong', { class: 'ocr-shortcut', 'data-shortcut': TRANSLATE_COMMAND });
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

  // How to change the shortcut, folded under the row: what stays in view is the shortcut itself
  // and, where the browser can open its page, the button that does.
  const shortcutDetails = disclosure([
    h('p', { class: 'help', text: t(isFirefox ? 'optSelShortcutHelpFirefox' : 'optSelShortcutHelpChrome') }),
    // A page may not open the browser's shortcut settings by a link, so the address is given as text.
    h('div', { class: 'ocr-address-row' }, address, copy),
  ]);
  // The limit and where a selection goes: said once, on request.
  const groupDetails = disclosure([h('p', { class: 'help', text: t('optSelHelp', { max: PASSAGE_MAX_CHARS }) }), h('p', { class: 'help', text: t('optSelPrivacy') })], { describedBy: 'selection-title' });

  const element = h(
    'div',
    { class: 'group', id: 'selection' },
    h('div', { class: 'group-head' }, h('h3', { id: 'selection-title', text: t('optTranslateSettings') }), groupDetails.button),
    groupDetails.panel,
    h(
      'div',
      { class: 'fields' },
      ...leadRows,
      switchRow(menu, 'optSelMenu', 'optSelMenuHelp'),
      switchRow(button, 'optSelButton', 'optSelButtonHelp'),
      fieldRow('optSelShortcut', null, shortcut, openSettings, shortcutDetails.button),
      warning,
      shortcutDetails.panel,
    ),
  );

  async function render() {
    const settings = await getSettings();
    menu.checked = settings.contextMenuTranslate !== false;
    button.checked = settings.selectionButton !== false;
    try {
      const command = (await chrome.commands.getAll()).find((candidate) => candidate.name === TRANSLATE_COMMAND);
      const assigned = command?.shortcut || '';
      shortcut.textContent = assigned || t('optOcrShortcutNone');
      shortcut.classList.toggle('missing', !assigned);
      // Not assigned, or assigned to something that does not work on this system: say so.
      const problem = !assigned ? 'optSelShortcutWarnNone' : isMac && OPTION_KEY.test(assigned) ? 'optSelShortcutWarnOption' : '';
      warning.hidden = !problem;
      warning.textContent = problem ? t(problem) : '';
    } catch {
      shortcut.textContent = '';
    }
  }

  return { element, render };
}
