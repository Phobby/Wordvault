// The interface language in the background script: the right-click menu, notifications and
// the toolbar button's title. The same loader as everywhere else (shared/i18n.js); this module
// only adds what the background script does for the others.
//
// The background script can be stopped at any time. Nothing is kept here: after it wakes up,
// the first `t` it needs waits for `ready()`, which reads the stored choice again.

import '../shared/i18n.js';

const { i18n } = globalThis.WV;

/** The interface text for a key (shared/i18n.js). Call `ready()` first. */
export const t = (key, values) => i18n.t(key, values);

/** Waits until the chosen language's strings are loaded. */
export const ready = () => i18n.load();

/** Registers the listeners. Called once, synchronously, when the background script starts. */
export function registerI18n() {
  // An update brings new strings: the stored copy is built again. When the browser starts, its
  // language may have changed, which matters while the choice is "follow the browser".
  chrome.runtime.onInstalled.addListener(() => i18n.publish({ force: true }).catch(() => {}));
  chrome.runtime.onStartup.addListener(() => i18n.publish().catch(() => {}));
  // (a language chosen elsewhere arrives through storage, shared/i18n.js; the menu follows it: menus.js)
}

/** Message handlers, for the background script's table. */
export const i18nHandlers = {
  // A content script cannot read the extension's files: it gets the strings from here (and
  // finds them in storage from then on).
  'wv:i18n:load': () => i18n.publish(),
};
