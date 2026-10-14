// The "Translate a selection" part of the options page: the right-click menu item, the button
// next to a selection, the keyboard shortcut and where to change it, and whether phrases kept
// from translations are asked by the quiz.

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
 * @param {{ flashSaved: () => void, switchRow: Function, fieldRow: Function }} page  Helpers of the options page.
 * @returns {{ element: HTMLElement, render: () => Promise<void> }}
 */
export function createPassageSection({ flashSaved, switchRow, fieldRow }) {
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
  const phrases = toggle('quizIncludePhrases');

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

  const element = h(
    'section',
    { class: 'card', id: 'selection' },
    h('h2', { text: t('optSelTitle') }),
    h('p', { class: 'help', text: t('optSelHelp', { max: PASSAGE_MAX_CHARS }) }),
    switchRow(menu, 'optSelMenu', 'optSelMenuHelp'),
    switchRow(button, 'optSelButton', 'optSelButtonHelp'),
    fieldRow('optSelShortcut', isFirefox ? 'optSelShortcutHelpFirefox' : 'optSelShortcutHelpChrome', shortcut),
    warning,
    // A page may not open the browser's shortcut settings by a link, so the address is given as text.
    h('div', { class: 'ocr-address-row' }, address, copy, openSettings),
    switchRow(phrases, 'optSelPhrases', 'optSelPhrasesHelp'),
    h('p', { class: 'help', text: t('optSelPrivacy') }),
  );

  async function render() {
    const settings = await getSettings();
    menu.checked = settings.contextMenuTranslate !== false;
    button.checked = settings.selectionButton !== false;
    phrases.checked = settings.quizIncludePhrases === true;
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
