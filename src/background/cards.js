// The cards of the AI features that work on a whole tab ("Translate this page with AI"): putting
// their scripts into the tab when the user asks, and the right-click menu, whose items come and
// go with the AI provider. Nothing is read from a page before its card is open there.

import { rebuildMenus } from './menus.js';
import { inject, sayOnButton } from '../features/passage/background.js';

/**
 * Opens a card on a tab, putting its scripts there first if they are not.
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

/** The menu items of the AI features come and go with the provider. Called once, at start-up. */
export function registerAiMenus() {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.aiConfig) rebuildMenus();
  });
}
