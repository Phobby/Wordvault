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

/** Progress of a scan, for the page to show: { stage: 'loading' | 'reading', progress: 0..1 }. */
function tellPage(tabId, { stage, progress }) {
  chrome.tabs.sendMessage(tabId, { type: 'wv:ocr:stage', stage, progress }, { frameId: 0 }).catch(() => {});
}

const askPage = (tabId) => chrome.tabs.sendMessage(tabId, { type: 'wv:ocr:start' }, { frameId: 0 });

/**
 * Chrome does not put content scripts into tabs that were already open when the extension was
 * installed, updated or reloaded (Firefox does). Such a tab gets them now: the user has just
 * asked for a scan of it, which is what `activeTab` allows.
 */
async function injectContentScripts(tabId) {
  if (!chrome.scripting) return false;
  const entries = chrome.runtime.getManifest().content_scripts || [];
  const files = entries.filter((entry) => entry.matches.includes('<all_urls>')).flatMap((entry) => entry.js);
  try {
    // What an earlier, now disconnected copy of the scripts left behind would make the new
    // copy believe it is already loaded.
    await chrome.scripting.executeScript({ target: { tabId }, func: () => delete globalThis.WV });
    await chrome.scripting.executeScript({ target: { tabId }, files });
    return true;
  } catch {
    return false; // a page no extension may touch
  }
}

/** Asks the page to let the user choose an area. */
export async function startScan(tab) {
  const target = tab?.id != null ? tab : await activeTab();
  if (!target) return;
  try {
    await askPage(target.id);
  } catch {
    try {
      if (!(await injectContentScripts(target.id))) throw new Error('cannot inject');
      await askPage(target.id);
    } catch {
      await sayNotHere(target);
    }
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
  'wv:ocr:begin': (payload) => startScan(Number.isInteger(payload?.tabId) ? { id: payload.tabId } : null),
  // From the offscreen document (Chrome), which cannot talk to tabs itself.
  'wv:ocr:progress': (payload) => {
    if (Number.isInteger(payload?.tabId)) tellPage(payload.tabId, payload);
    return true;
  },
  // From the page, once an area was chosen and the selection UI is off the screen.
  'wv:ocr:scan': (payload, sender) => {
    const tab = sender.tab;
    if (!tab || sender.frameId !== 0) throw new Error('not from a page');
    return scanTab({ area: payload?.area || null, viewport: payload?.viewport }, tab, (progress) => tellPage(tab.id, progress));
  },
};
