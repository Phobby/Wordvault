// The "Keyboard shortcuts" group of the translation settings: every command that has a shortcut,
// with the keys assigned to it, one button to the browser's shortcut settings where the browser
// can open them, and how to change them under "Details".

import { disclosure } from './disclosure.js';

const { h, t } = globalThis.WV;

const isFirefox = chrome.runtime.getURL('').startsWith('moz-extension:');
/** Where the browser lets shortcuts be changed. Extension pages may not link there; the address is offered for copying. */
const SHORTCUTS_ADDRESS = isFirefox ? 'about:addons' : 'chrome://extensions/shortcuts';
const isMac = /mac/i.test(navigator.userAgentData?.platform || navigator.platform || '');
/** The Option key, as the browsers write it in a shortcut ("⌥⇧S", "Alt+Shift+S"). */
const OPTION_KEY = /⌥|Alt|Option/i;

/** The commands shown, in order (manifest "commands"), and what is said when one cannot be used. */
const COMMANDS = [
  { name: 'translate-selection', labelKey: 'optShortcutTranslate', warnNone: 'optSelShortcutWarnNone', warnOption: 'optSelShortcutWarnOption' },
  { name: 'scan-screen', labelKey: 'optShortcutScan', warnNone: 'optOcrShortcutWarnNone', warnOption: 'optOcrShortcutWarnOption' },
];

/** @returns {{ element: HTMLElement, render: () => Promise<void> }} */
export function createShortcutsSection() {
  const rows = COMMANDS.map((command) => ({
    ...command,
    keys: h('strong', { class: 'ocr-shortcut', 'data-shortcut': command.name }),
    warning: h('p', { class: 'ocr-warning', role: 'status', hidden: true }),
  }));

  // Firefox can open its shortcut page for us (commands.openShortcutSettings, Firefox 137+).
  const openSettings =
    typeof chrome.commands?.openShortcutSettings === 'function'
      ? h('button', { class: 'wv-btn wv-btn-sm', type: 'button', 'data-action': 'open-shortcuts', text: t('optOcrShortcutOpen'), onclick: () => chrome.commands.openShortcutSettings().catch(() => {}) })
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
  const details = disclosure(
    [
      h('p', { class: 'help', text: t(isFirefox ? 'optSelShortcutHelpFirefox' : 'optSelShortcutHelpChrome') }),
      // A page may not open the browser's shortcut settings by a link, so the address is given as text.
      h('div', { class: 'ocr-address-row' }, address, copy),
      h('p', { class: 'help', text: t('optShortcutsMenu') }),
    ],
    { describedBy: 'shortcuts-title' },
  );

  const element = h(
    'div',
    { class: 'group', id: 'shortcuts' },
    h('div', { class: 'group-head' }, h('h3', { id: 'shortcuts-title', text: t('optShortcutsTitle') }), details.button),
    details.panel,
    h(
      'div',
      { class: 'fields' },
      h('dl', { class: 'shortcut-list' }, rows.flatMap(({ labelKey, keys }) => [h('dt', { text: t(labelKey) }), h('dd', null, keys)])),
      ...rows.map(({ warning }) => warning),
      openSettings && h('div', { class: 'buttons' }, openSettings),
    ),
  );

  async function render() {
    let commands = [];
    try {
      commands = await chrome.commands.getAll();
    } catch {
      return;
    }
    for (const row of rows) {
      const assigned = commands.find((candidate) => candidate.name === row.name)?.shortcut || '';
      row.keys.textContent = assigned || t('optOcrShortcutNone');
      row.keys.classList.toggle('missing', !assigned);
      // Not assigned, or assigned to something that does not work on this system: say so.
      const problem = !assigned ? row.warnNone : isMac && OPTION_KEY.test(assigned) ? row.warnOption : '';
      row.warning.hidden = !problem;
      row.warning.textContent = problem ? t(problem) : '';
    }
  }

  return { element, render };
}
