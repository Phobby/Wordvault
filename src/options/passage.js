// The "Translation settings" group: the rows the page puts first (the target language, double
// click), then how a selection is translated: the right-click menu item and the button next to a
// selection. The shortcut is with the others (options/shortcuts.js).

import { disclosure } from './disclosure.js';
import { PASSAGE_MAX_CHARS } from '../lib/passage.js';
import { getSettings, updateSettings } from '../lib/settings.js';

const { h, t } = globalThis.WV;

/**
 * @param {{ flashSaved: () => void, switchRow: Function, leadRows?: Array<Node | string> }} page
 *        Helpers of the options page; leadRows: rows of its own that open the group.
 * @returns {{ element: HTMLElement, render: () => Promise<void> }}
 */
export function createPassageSection({ flashSaved, switchRow, leadRows = [] }) {
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
      switchRow(menu, 'optSelMenu'),
      switchRow(button, 'optSelButton', 'optSelButtonHelp'),
    ),
  );

  async function render() {
    const settings = await getSettings();
    menu.checked = settings.contextMenuTranslate !== false;
    button.checked = settings.selectionButton !== false;
  }

  return { element, render };
}
