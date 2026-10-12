// Screen text scanning: how it is started (keyboard shortcut, right-click menu, the toolbar
// button's menu, the vault popup) and the message the page sends once an area was chosen.
// All of these are things the user does, which is what lets `activeTab` cover the screenshot:
// the extension has no standing permission to look at any tab.

import { scanTab } from './scan.js';

export const SCAN_COMMAND = 'scan-screen';
const MENU_ID = 'wv-ocr-scan';
/** How long the toolbar button says that this page cannot be scanned. */
const BADGE_MS = 4000;

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

/** Pages without our content script (browser pages, the add-on stores) cannot be scanned. */
async function sayNotHere(tab) {
  try {
    await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#b42318' });
    await chrome.action.setBadgeText({ tabId: tab.id, text: '!' });
    await chrome.action.setTitle({ tabId: tab.id, title: chrome.i18n.getMessage('ocrErrForbidden') });
    setTimeout(() => {
      chrome.action.setBadgeText({ tabId: tab.id, text: '' }).catch(() => {});
      chrome.action.setTitle({ tabId: tab.id, title: 'Wordvault' }).catch(() => {});
    }, BADGE_MS);
  } catch {
    // The tab is gone.
  }
}

/** Asks the page to let the user choose an area. */
export async function startScan(tab) {
  const target = tab?.id != null ? tab : await activeTab();
  if (!target) return;
  try {
    await chrome.tabs.sendMessage(target.id, { type: 'wv:ocr:start' }, { frameId: 0 });
  } catch {
    await sayNotHere(target);
  }
}

function createMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: chrome.i18n.getMessage('ocrMenuScan'),
      // 'action': the menu of the toolbar button.
      contexts: ['page', 'frame', 'image', 'video', 'selection', 'link', 'action'],
    });
  });
}

/** Registers the listeners. Called once, synchronously, when the background script starts. */
export function registerScreenOcr() {
  chrome.runtime.onInstalled.addListener(createMenu);
  chrome.runtime.onStartup.addListener(createMenu);
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === MENU_ID) startScan(tab);
  });
  chrome.commands.onCommand.addListener((command, tab) => {
    if (command === SCAN_COMMAND) startScan(tab);
  });
}

/** Message handlers of this feature, for the background script's table. */
export const screenOcrHandlers = {
  // From the vault popup: scan the tab the popup was opened on.
  'wv:ocr:begin': () => startScan(null),
  // From the page, once an area was chosen and the selection UI is off the screen.
  'wv:ocr:scan': (payload, sender) => {
    const tab = sender.tab;
    if (!tab || sender.frameId !== 0) throw new Error('not from a page');
    return scanTab({ area: payload?.area || null, viewport: payload?.viewport }, tab, (stage) => {
      chrome.tabs.sendMessage(tab.id, { type: 'wv:ocr:stage', stage }, { frameId: 0 }).catch(() => {});
    });
  },
};
