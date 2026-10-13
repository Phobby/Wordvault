// The right-click menu. The browser keeps the menu between starts of the background script, so
// it is built when the extension is installed or updated and when the browser starts, and built
// again when a setting that decides about an item changes. One place does it, because the menu
// is emptied first, and two parts of the extension doing that would take each other's items away.

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
      const items = [];
      for (const build of builders) items.push(await Promise.resolve().then(build).catch(() => null));
      await new Promise((resolve) => chrome.contextMenus.removeAll(resolve));
      for (const item of items.filter(Boolean)) chrome.contextMenus.create(item, () => void chrome.runtime.lastError);
    })
    .catch(() => {});
  return turn;
}
