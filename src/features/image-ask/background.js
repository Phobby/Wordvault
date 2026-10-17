// "Ask about the image": how it is started (right-click menu, a keyboard shortcut the user can
// set) and the picture of the chosen area. Like the screen scan, every start is something the
// user does, which is what lets `activeTab` cover the screenshot.

import { t } from '../../background/i18n.js';
import { addMenuItem } from '../../background/menus.js';
import { startInPage } from '../screen-ocr/background.js';
import { captureTab } from '../screen-ocr/scan.js';
import { cropCapture } from './crop.js';

export const ASK_IMAGE_COMMAND = 'ask-image';
const MENU_ID = 'wv-image-ask';

const menuItem = () => ({
  id: MENU_ID,
  title: t('imageMenuAsk'),
  contexts: ['page', 'frame', 'image', 'video', 'selection', 'link', 'action'],
});

/** Registers the listeners. Called once, synchronously, when the background script starts. */
export function registerImageAsk() {
  addMenuItem(menuItem);
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === MENU_ID) startInPage(tab, 'wv:image:start');
  });
  chrome.commands.onCommand.addListener((command, tab) => {
    if (command === ASK_IMAGE_COMMAND) startInPage(tab, 'wv:image:start');
  });
}

export const imageAskHandlers = {
  // From the page, once an area was chosen and the selection UI is off the screen.
  'wv:image:capture': async (payload, sender) => {
    const tab = sender.tab;
    if (!tab || sender.frameId !== 0) throw new Error('not from a page');
    const dataUrl = await captureTab(tab.windowId);
    return cropCapture(dataUrl, payload?.area || null, payload?.viewport);
  },
};
