// The right-click menu. The browser keeps the menu between starts of the background script, so
// it is built when the extension is installed or updated and when the browser starts, and built
// again when a setting that decides about an item changes. One place does it, because the menu
// is emptied first, and two parts of the extension doing that would take each other's items away.

import { ready } from './i18n.js';

const { CACHE_KEY } = globalThis.WV.i18n;

/** What each part contributes: its item, or null when it wants none right now. */
const builders = [];
let turn = Promise.resolve();

/** @param {() => (object | null | Promise<object | null>)} build  Properties for contextMenus.create(). */
export function addMenuItem(build) {
  builders.push(build);
}

/** Builds the menu from scratch. Calls take turns, so the last one always decides. */
export function rebuildMenus() {
  turn = turn
    .then(async () => {
      await ready(); // (the titles are in the interface language)
      const items = [];
      for (const build of builders) items.push(await Promise.resolve().then(build).catch(() => null));
      await new Promise((resolve) => chrome.contextMenus.removeAll(resolve));
      for (const item of items.filter(Boolean)) chrome.contextMenus.create(item, () => void chrome.runtime.lastError);
    })
    .catch(() => {});
  return turn;
}

/**
 * Gives the items there are their titles in the interface language again, after it changed
 * (contextMenus.update: the items stay where they are).
 */
export function relabelMenus() {
  turn = turn
    .then(async () => {
      await ready();
      for (const build of builders) {
        const item = await Promise.resolve().then(build).catch(() => null);
        if (item?.id && item.title) await new Promise((resolve) => chrome.contextMenus.update(item.id, { title: item.title }, () => resolve(void chrome.runtime.lastError)));
      }
    })
    .catch(() => {});
  return turn;
}

// A language chosen in any part of Wordvault arrives here through storage (shared/i18n.js).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[CACHE_KEY]?.newValue) relabelMenus();
});
