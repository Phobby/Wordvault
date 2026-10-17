// The "Screen translation" group of the translation section: two switches, one of them for
// troubleshooting and folded away. The shortcut is with the others (options/shortcuts.js).
// The language is always found by itself and the engine's confidence is fixed
// (features/screen-ocr/scan.js); neither is a setting.

import { disclosure } from './disclosure.js';
import { getSettings, updateSettings } from '../lib/settings.js';

const { h, t } = globalThis.WV;

/**
 * @param {{ flashSaved: () => void, switchRow: Function }} page  Helpers of the options page.
 * @returns {{ element: HTMLElement, render: () => Promise<void> }}
 */
export function createOcrSection({ flashSaved, switchRow }) {
  const save = async (patch) => {
    await updateSettings(patch);
    flashSaved();
  };

  const showBoxes = h('input', { type: 'checkbox', onchange: () => save({ ocrShowBoxes: showBoxes.checked }) });
  const remember = h('input', { type: 'checkbox', onchange: () => save({ ocrRememberArea: remember.checked }) });

  // What it does in one line; where the picture goes and where else a scan starts, on request.
  const details = disclosure([h('p', { class: 'help', text: t('optOcrPrivacy') }), h('p', { class: 'help', text: t('optOcrAlsoFrom') })], { describedBy: 'ocr-title' });
  const element = h(
    'div',
    { class: 'group', id: 'ocr' },
    h('div', { class: 'group-head' }, h('h3', { id: 'ocr-title', text: t('optOcrTitle') }), details.button),
    details.panel,
    h('p', { class: 'help', text: t('optOcrHelp') }),
    h('div', { class: 'fields' }, switchRow(remember, 'optOcrRemember', 'optOcrRememberHelp')),
    h('details', { class: 'more' }, h('summary', { text: t('optAdvanced') }), h('div', { class: 'fields' }, switchRow(showBoxes, 'optOcrShowBoxes', 'optOcrShowBoxesHelp'))),
  );

  async function render() {
    const settings = await getSettings();
    showBoxes.checked = settings.ocrShowBoxes === true;
    remember.checked = settings.ocrRememberArea === true;
  }

  return { element, render };
}
