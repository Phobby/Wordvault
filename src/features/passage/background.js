// Translating what is selected, asked for from outside the page: "Translate with Wordvault" in
// the right-click menu of a selection, and the keyboard shortcut. The page shows the result
// itself (content/translate-button.js). Where Wordvault cannot draw on the page (the browser's
// own pages, its PDF viewer, the add-on stores), the menu's translation is shown in a small
// window of its own instead.
//
// Both are things the user does, which is what lets `activeTab` reach a tab whose content
// scripts are missing (Chrome, after the extension was installed or reloaded).

import { addMenuItem, rebuildMenus } from '../../background/menus.js';
import { getSettings } from '../../lib/settings.js';

export const TRANSLATE_COMMAND = 'translate-selection';
const MENU_ID = 'wv-translate-selection';
/** The window that stands in for a page. */
const WINDOW = { width: 420, height: 520 };
const WINDOW_KEY = 'passageWindow';
/** What such a window is to translate waits here until the window has read it: `passage:<id>`. */
const PENDING_PREFIX = 'passage:';
/** How long the toolbar button says that there was nothing to translate. */
const BADGE_MS = 4000;

/**
 * Asks a frame (or, without one, every frame) of a tab to translate its selection.
 * @returns {Promise<'opened' | 'nothing' | 'unreachable'>} 'nothing': there are content
 *          scripts, and none of them had anything to translate.
 */
async function askPage(tabId, message, frameId) {
  try {
    const opened = await chrome.tabs.sendMessage(tabId, { type: 'wv:passage:open', ...message }, frameId == null ? undefined : { frameId });
    return opened === true ? 'opened' : 'nothing';
  } catch {
    return 'unreachable';
  }
}

/**
 * Chrome does not put content scripts into tabs that were open before the extension was
 * installed, updated or reloaded. Such a tab gets them now, in the frame that was asked for
 * (or, for the shortcut, in every frame the browser lets us into).
 */
async function inject(tabId, frameId) {
  if (!chrome.scripting) return false;
  const entries = (chrome.runtime.getManifest().content_scripts || []).filter((entry) => entry.matches.includes('<all_urls>'));
  const everyFrame = entries.filter((entry) => entry.all_frames).flatMap((entry) => entry.js);
  const topOnly = entries.filter((entry) => !entry.all_frames).flatMap((entry) => entry.js);
  const target = frameId == null ? { tabId, allFrames: true } : { tabId, frameIds: [frameId] };
  try {
    // What an earlier, now disconnected copy of the scripts left behind would make the new
    // copy believe it is already loaded: that is cleared away. A frame whose scripts are
    // working is left as it is (there the files below find themselves loaded and do nothing).
    await chrome.scripting.executeScript({
      target,
      func: () => {
        let working = false;
        try {
          working = globalThis.WV?.translateButton?.alive() === true;
        } catch {
          working = false;
        }
        if (!working) delete globalThis.WV;
      },
    });
    await chrome.scripting.executeScript({ target, files: everyFrame });
    if (!frameId && topOnly.length > 0) await chrome.scripting.executeScript({ target: { tabId }, files: topOnly }).catch(() => {});
    return true;
  } catch {
    return false; // a page no extension may touch
  }
}

/** Says on the toolbar button why nothing happened; it has no other place to say it. */
async function sayOnButton(tab, messageKey) {
  try {
    await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#b42318' });
    await chrome.action.setBadgeText({ tabId: tab.id, text: '!' });
    await chrome.action.setTitle({ tabId: tab.id, title: chrome.i18n.getMessage(messageKey) });
    setTimeout(() => {
      chrome.action.setBadgeText({ tabId: tab.id, text: '' }).catch(() => {});
      chrome.action.setTitle({ tabId: tab.id, title: 'Wordvault' }).catch(() => {});
    }, BADGE_MS);
  } catch {
    // The tab is gone.
  }
}

/**
 * The translation in a small window of its own. The text is handed over through the
 * browser's session storage (memory only, gone when the browser closes) and taken out by the
 * window as soon as it has read it; it is not written to disk and is not part of the address.
 */
async function openWindow(text, tab) {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  let address = `passage/passage.html?id=${id}`;
  if (chrome.storage.session) await chrome.storage.session.set({ [PENDING_PREFIX + id]: { text, at: Date.now() } });
  else address = `passage/passage.html#${encodeURIComponent(text)}`; // no session storage here
  // One such window at a time: a new translation replaces the last one.
  const previous = chrome.storage.session ? (await chrome.storage.session.get(WINDOW_KEY))[WINDOW_KEY] : null;
  if (Number.isInteger(previous)) await chrome.windows.remove(previous).catch(() => {});
  const parent = tab?.windowId != null ? await chrome.windows.get(tab.windowId).catch(() => null) : null;
  const place = parent && Number.isFinite(parent.left) ? { left: Math.max(0, Math.round(parent.left + (parent.width - WINDOW.width) / 2)), top: Math.max(0, Math.round(parent.top + 90)) } : {};
  const created = await chrome.windows.create({ url: chrome.runtime.getURL(address), type: 'popup', focused: true, ...WINDOW, ...place }).catch(() => chrome.windows.create({ url: chrome.runtime.getURL(address), type: 'popup', ...WINDOW }));
  if (chrome.storage.session && created?.id != null) await chrome.storage.session.set({ [WINDOW_KEY]: created.id });
  return created;
}

/**
 * @param {object} tab
 * @param {Object} how
 * @param {string} [how.text]     What the browser says is selected (the menu passes it along).
 * @param {number} [how.frameId]  The frame the menu was opened in.
 * @param {boolean} how.menu      From the right-click menu (true) or the shortcut (false).
 * @returns {Promise<'opened' | 'window' | 'nothing' | 'unreachable'>}
 */
export async function translateSelection(tab, { text = '', frameId, menu }) {
  if (tab?.id == null) return 'unreachable';
  const message = menu ? { menu: true, text } : {};
  const frame = menu ? frameId || 0 : undefined;
  let outcome = await askPage(tab.id, message, frame);
  // The shortcut goes to every frame, and a frame that was loaded later can have the scripts
  // while the page around it does not: "nothing selected" is only believed from the page itself.
  const missing = outcome === 'unreachable' || (!menu && outcome === 'nothing' && !(await chrome.tabs.sendMessage(tab.id, { type: 'wv:passage:ping' }, { frameId: 0 }).catch(() => false)));
  if (missing && (await inject(tab.id, frame))) outcome = await askPage(tab.id, message, frame);
  if (outcome === 'opened') return outcome;
  // The page cannot show it (or the frame had nothing to show it for): the menu still knows the text.
  if (menu && text.trim()) {
    await openWindow(text, tab);
    return 'window';
  }
  await sayOnButton(tab, outcome === 'nothing' ? 'selNothingSelected' : 'selNotHere');
  return outcome;
}

async function menuItem() {
  if ((await getSettings()).contextMenuTranslate === false) return null;
  return { id: MENU_ID, title: chrome.i18n.getMessage('menuTranslate'), contexts: ['selection'] };
}

/** Registers the listeners. Called once, synchronously, when the background script starts. */
export function registerPassage() {
  addMenuItem(menuItem);
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === MENU_ID) translateSelection(tab, { text: info.selectionText || '', frameId: info.frameId, menu: true }).catch(() => {});
  });
  chrome.commands.onCommand.addListener((command, tab) => {
    if (command !== TRANSLATE_COMMAND) return;
    Promise.resolve(tab?.id != null ? tab : chrome.tabs.query({ active: true, currentWindow: true }).then(([active]) => active))
      .then((target) => translateSelection(target, { menu: false }))
      .catch(() => {});
  });
  // The switch in the settings takes the item out of the menu, and puts it back.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.settings) return;
    const was = changes.settings.oldValue?.contextMenuTranslate !== false;
    const is = changes.settings.newValue?.contextMenuTranslate !== false;
    if (was !== is) rebuildMenus();
  });
}

/** Message handlers of this feature, for the background script's table. */
export const passageHandlers = {
  // From the window that stands in for a page: what it is to translate. Handed out once.
  'wv:passage:pending': async (payload) => {
    const key = PENDING_PREFIX + String(payload?.id || '');
    if (!chrome.storage.session || key === PENDING_PREFIX) return null;
    const pending = (await chrome.storage.session.get(key))[key];
    await chrome.storage.session.remove(key);
    return typeof pending?.text === 'string' ? pending.text : null;
  },
};
