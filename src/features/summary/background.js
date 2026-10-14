// "Summarise this page": how it is started. The right-click menu of a page and the vault popup
// both end here, and both are things the user does. The item and the button are only there
// while an AI provider is set up.
//
// What reads the page and shows the summary (Mozilla's Readability, content/extract.js,
// content/card.js) is not part of every page: it is put into a tab when its user asks for a
// summary of it. Everything after that is between the card on the page and ai/background.js;
// nothing is read from the page, let alone sent, before the user has seen how much it is and
// said yes.

import { t } from '../../background/i18n.js';
import { activeAi } from '../../ai/config.js';
import { addMenuItem, rebuildMenus } from '../../background/menus.js';
import { inject, sayOnButton } from '../passage/background.js';

const MENU_ID = 'wv-summarize-page';
/** In this order: the library, what reads the page with it, what shows the result. */
const FILES = ['vendor/readability/Readability.js', 'features/summary/content/extract.js', 'features/summary/content/card.js'];

/**
 * Opens a card of the AI features on a tab, putting its scripts there first if they are not.
 * @param {object} tab
 * @param {string[]} files   What the card needs, in load order.
 * @param {string} message   The message its script answers with `true` once the card is open.
 * @param {string} notHere   Message key for the toolbar button where it cannot be done.
 * @returns {Promise<'opened' | 'unreachable'>} 'unreachable': a page Wordvault cannot work on
 *          (the browser's own pages, its PDF viewer, the add-on stores).
 */
export async function openCard(tab, files, message, notHere) {
  if (tab?.id == null) return 'unreachable';
  const open = () => chrome.tabs.sendMessage(tab.id, { type: message }, { frameId: 0 }).then((opened) => opened === true);
  // A tab that has shown the card before still has it: it only needs to be asked.
  if (await open().catch(() => false)) return 'opened';
  try {
    if (!chrome.scripting) throw new Error('no scripting');
    // The card is drawn with what every page already has (shared/dom.js, shared/styles.js),
    // except in Chrome in a tab that was open before the extension was installed or reloaded.
    const present = await chrome.tabs.sendMessage(tab.id, { type: 'wv:passage:ping' }, { frameId: 0 }).catch(() => false);
    if (!present && !(await inject(tab.id, 0))) throw new Error('cannot inject');
    await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, files });
    if (await open()) return 'opened';
  } catch {
    // falls through
  }
  await sayOnButton(tab, notHere);
  return 'unreachable';
}

/** Opens the summary card on a tab. */
export const openSummary = (tab) => openCard(tab, FILES, 'wv:summary:open', 'sumNotHere');

async function menuItem() {
  if (!(await activeAi()).ready) return null;
  return { id: MENU_ID, title: t('sumMenu'), contexts: ['page'] };
}

/** Registers the listeners. Called once, synchronously, when the background script starts. */
export function registerSummary() {
  addMenuItem(menuItem);
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === MENU_ID) openSummary(tab).catch(() => {});
  });
  // The item comes and goes with the provider.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.aiConfig) rebuildMenus();
  });
}

/** Message handlers of this feature, for the background script's table. */
export const summaryHandlers = {
  // From the vault popup: summarise the tab the popup was opened on.
  'wv:summary:start': (payload, sender) => {
    if (!String(sender.url || '').startsWith(chrome.runtime.getURL(''))) throw new Error('not allowed from here');
    return openSummary(Number.isInteger(payload?.tabId) ? { id: payload.tabId } : null);
  },
};
