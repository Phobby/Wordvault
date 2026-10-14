// "Translate this page with AI" (experimental): how it is started. Like the summary
// (features/summary/background.js): an item in the right-click menu of a page and a button in
// the vault popup, both only there while an AI provider is set up, and what works on the page
// is put into a tab only when its user asks for it. Nothing is read from the page, let alone
// sent, before the user has seen how much it is and said yes on the card.

import { t } from '../../background/i18n.js';
import { activeAi } from '../../ai/config.js';
import { addMenuItem } from '../../background/menus.js';
import { openCard } from '../summary/background.js';

const MENU_ID = 'wv-translate-page';
const FILES = ['features/page-translate/content/collect.js', 'features/page-translate/content/card.js'];

/** @returns {Promise<'opened' | 'unreachable'>} */
export const openPageTranslation = (tab) => openCard(tab, FILES, 'wv:page-translate:open', 'sumNotHere');

async function menuItem() {
  if (!(await activeAi()).ready) return null;
  return { id: MENU_ID, title: t('ptMenu'), contexts: ['page'] };
}

/** Registers the listeners. Called once, synchronously, when the background script starts. */
export function registerPageTranslation() {
  addMenuItem(menuItem); // (the menu is rebuilt when the provider changes: features/summary/background.js)
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === MENU_ID) openPageTranslation(tab).catch(() => {});
  });
}

/** Message handlers of this feature, for the background script's table. */
export const pageTranslationHandlers = {
  // From the vault popup: translate the tab the popup was opened on.
  'wv:page-translate:start': (payload, sender) => {
    if (!String(sender.url || '').startsWith(chrome.runtime.getURL(''))) throw new Error('not allowed from here');
    return openPageTranslation(Number.isInteger(payload?.tabId) ? { id: payload.tabId } : null);
  },
};
