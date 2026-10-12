// A stand-in for the parts of chrome.* that the code under test touches, backed by memory.
// Each "device" has its own storage; use(device) makes it the one the code sees.

function storageArea() {
  const data = new Map();
  const copy = (value) => structuredClone(value);
  return {
    data,
    async get(keys) {
      if (keys === null || keys === undefined) return Object.fromEntries([...data].map(([key, value]) => [key, copy(value)]));
      const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
      return Object.fromEntries(list.filter((key) => data.has(key)).map((key) => [key, copy(data.get(key))]));
    },
    async set(items) {
      for (const [key, value] of Object.entries(items)) data.set(key, copy(value));
    },
    async remove(keys) {
      for (const key of [].concat(keys)) data.delete(key);
    },
    async clear() {
      data.clear();
    },
  };
}

/**
 * The browser's sync storage, with the limits real browsers enforce. Devices signed in to the
 * same browser account share one (pass the same area to createDevice).
 */
export function syncStorageArea({ quotaBytes = 102_400, quotaBytesPerItem = 8192 } = {}) {
  const area = storageArea();
  const sizeOf = (key, value) => key.length + JSON.stringify(value).length;
  const used = () => [...area.data].reduce((sum, [key, value]) => sum + sizeOf(key, value), 0);
  const plainSet = area.set;
  return Object.assign(area, {
    QUOTA_BYTES: quotaBytes,
    QUOTA_BYTES_PER_ITEM: quotaBytesPerItem,
    /** Calls made, to check that writes are batched. */
    calls: [],
    /** Set to an Error to make the next write fail with it. */
    failNextWrite: null,
    getBytesInUse: async () => used(),
    async set(items) {
      area.calls.push(`set ${Object.keys(items).length}`);
      if (area.failNextWrite) {
        const error = area.failNextWrite;
        area.failNextWrite = null;
        throw error;
      }
      for (const [key, value] of Object.entries(items)) {
        if (sizeOf(key, value) > quotaBytesPerItem) throw new Error('QUOTA_BYTES_PER_ITEM quota exceeded');
      }
      const after = used() - Object.keys(items).reduce((sum, key) => sum + (area.data.has(key) ? sizeOf(key, area.data.get(key)) : 0), 0) + Object.entries(items).reduce((sum, [key, value]) => sum + sizeOf(key, value), 0);
      if (after > quotaBytes) throw new Error('QUOTA_BYTES quota exceeded');
      await plainSet(items);
    },
    async remove(keys) {
      area.calls.push(`remove ${[].concat(keys).length}`);
      for (const key of [].concat(keys)) area.data.delete(key);
    },
  });
}

/**
 * @param {string} [name]
 * @param {{ uiLanguage?: string, detect?: (text: string) => string | null, sync?: object }} [options]
 *   `sync`: the browser sync storage this device is signed in to (syncStorageArea()); a
 *   storage of its own if left out.
 *   `detect` plays the browser's language detector: it returns a language code, or null for
 *   "cannot tell". Every text it is asked about is recorded in `detected`.
 */
export function createDevice(name = 'device', { uiLanguage = 'en-US', detect = () => null, sync = syncStorageArea() } = {}) {
  const local = storageArea();
  /** Session storage: memory the browser clears when it is closed (see restartBrowser). */
  const session = storageArea();
  const detected = [];
  const i18n = {
    getUILanguage: () => uiLanguage,
    getMessage: (key) => key,
    detectLanguage: async (text) => {
      detected.push(text);
      const language = detect(text);
      return language ? { isReliable: true, languages: [{ language, percentage: 100 }] } : { isReliable: false, languages: [] };
    },
  };
  // The browser around the extension, as far as the quiz is concerned. Tests change these
  // fields to set a scene: no tab, window in the background, a page that says "not now", a
  // browser that can or cannot open popups and windows.
  const browser = {
    /** The active tab, or null. */
    tab: { id: 1, windowId: 1, active: true, audible: false },
    focused: true,
    /** Where the browser window is on the screen. */
    bounds: { left: 100, top: 50, width: 1200, height: 800 },
    /** The page in the active tab: `supported` false plays a page extensions cannot run on;
     *  `blocked` is what it says about the moment ('typing', 'video_playing' ..., '' = fine). */
    page: { supported: true, blocked: '' },
    /** Overrides what the page answers to a message, if set. */
    reply: null,
    /** Messages delivered to the tab. */
    sent: [],
    /** Every alarm that was ever created, in order. */
    alarmsCreated: [],
    /** What this browser offers for showing a quiz besides the card on the page. By default
     *  nothing, so that a quiz ends up as a card. */
    can: { popup: false, window: false, notification: false },
    /** How the toolbar popup behaves: `refuses` is the error openPopup() fails with ('' = it
     *  works); `opens` false plays a popup that never loads its page. */
    popup: { refuses: '', opens: true },
    /** The same for windows.create(); `refusesPosition`: only a placed window is refused. */
    window: { refuses: '', opens: true, refusesPosition: false },
    /** Called when a quiz page has loaded (surface 'popup' or 'window'); the test plays the page. */
    onQuizPage: null,
    /** What the toolbar button opens right now. */
    popupPage: 'popup/popup.html',
    /** Calls made to the browser for showing things, in order. */
    calls: [],
    /** Windows that are open (created through windows.create and not removed). */
    windows: [],
    notifications: [],
    /** The address the browser gives this extension for OAuth redirects. */
    redirect: 'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/',
    /** Plays the sign-in window: gets the address it was opened with and whether a window may
     *  be shown, returns the address it ended on, or throws (the user closed it). */
    signIn: null,
    /** The sign-in windows that were asked for: `{ url, interactive }`. */
    signIns: [],
  };
  const alarmMap = new Map();
  const alarms = {
    get: async (alarmName) => alarmMap.get(alarmName),
    create: async (alarmName, info) => {
      const alarm = { name: alarmName, scheduledTime: info.when ?? Date.now() + (info.delayInMinutes || 0) * 60_000 };
      if (info.periodInMinutes) alarm.periodInMinutes = info.periodInMinutes;
      alarmMap.set(alarmName, alarm);
      browser.alarmsCreated.push({ ...alarm });
    },
    clear: async (alarmName) => alarmMap.delete(alarmName),
  };
  const pageLoads = (surface, info) => setTimeout(() => browser.onQuizPage?.(surface, info), 0);
  const tabs = {
    query: async () => (browser.tab ? [browser.tab] : []),
    sendMessage: async (tabId, message, options) => {
      browser.sent.push({ tabId, message, options });
      if (browser.reply) return browser.reply(message);
      if (!browser.page.supported) throw new Error('Could not establish connection. Receiving end does not exist.');
      if (message.type === 'wv:quiz:probe') return { blocked: browser.page.blocked };
      if (message.type === 'wv:quiz:show') return browser.page.blocked && !message.force ? { shown: false, reason: browser.page.blocked } : { shown: true };
      return undefined;
    },
  };
  let nextWindowId = 100;
  const windows = {
    get: async (id) => ({ id, focused: browser.focused, ...browser.bounds }),
    create: async (data) => {
      browser.calls.push(`windows.create${data.left === undefined ? '' : ` at ${data.left},${data.top}`}`);
      if (browser.window.refuses) throw new Error(browser.window.refuses);
      if (browser.window.refusesPosition && data.left !== undefined) throw new Error('Invalid value for bounds. Bounds must be at least 50% within visible screen space.');
      const created = { id: nextWindowId++, ...data };
      browser.windows.push(created);
      if (browser.window.opens) pageLoads('window', created);
      return created;
    },
    remove: async (id) => {
      browser.calls.push('windows.remove');
      browser.windows = browser.windows.filter((window) => window.id !== id);
    },
  };
  const action = {
    setPopup: async ({ popup }) => {
      browser.popupPage = popup;
    },
    openPopup: async (options) => {
      browser.calls.push(`openPopup ${browser.popupPage}`);
      if (browser.popup.refuses) throw new Error(browser.popup.refuses);
      if (browser.popup.opens) pageLoads('popup', options);
    },
  };
  const notifications = {
    create: async (id, options) => {
      browser.calls.push('notifications.create');
      browser.notifications.push({ id, ...options });
      return id;
    },
    clear: async () => true,
  };
  const api = {
    storage: { local, sync, session },
    i18n,
    alarms,
    tabs,
    runtime: { getManifest: () => ({ version: '0.0.0-test', action: { default_popup: 'popup/popup.html' } }), getURL: (path) => `test-extension://${path}` },
    permissions: { contains: async () => browser.can.notification },
    identity: {
      getRedirectURL: () => browser.redirect,
      launchWebAuthFlow: async ({ url, interactive }) => {
        browser.signIns.push({ url, interactive: Boolean(interactive) });
        if (!browser.signIn) throw new Error('User interaction required.');
        return browser.signIn(new URL(url), Boolean(interactive));
      },
    },
    // What a browser cannot do is simply not there, as in a real one.
    get action() {
      return browser.can.popup ? action : { setPopup: action.setPopup };
    },
    get windows() {
      return browser.can.window ? windows : { get: windows.get, remove: windows.remove };
    },
    get notifications() {
      return browser.can.notification ? notifications : undefined;
    },
  };
  const shows = () => browser.sent.filter((sent) => sent.message.type === 'wv:quiz:show');
  return {
    name,
    local,
    sync,
    detected,
    browser,
    /** Name -> time of every alarm that is set. */
    alarmTimes: () => Object.fromEntries([...alarmMap].map(([alarmName, alarm]) => [alarmName, alarm.scheduledTime])),
    /** The alarm as the browser holds it, or undefined. */
    alarm: (alarmName) => alarmMap.get(alarmName),
    /**
     * The browser fires an alarm: a one-off alarm is gone afterwards, a repeating one moves on
     * by its period. Returns false if there is no such alarm.
     */
    fireAlarm: (alarmName) => {
      const alarm = alarmMap.get(alarmName);
      if (!alarm) return false;
      if (alarm.periodInMinutes) alarm.scheduledTime += alarm.periodInMinutes * 60_000;
      else alarmMap.delete(alarmName);
      return true;
    },
    /** A browser restart, as far as timers go: alarms are gone, storage stays. */
    forgetAlarms: () => alarmMap.clear(),
    /** The browser is closed and opened again: what was only held for the session is gone. */
    restartBrowser: () => {
      alarmMap.clear();
      session.data.clear();
    },
    chrome: api,
    /** The quizzes sent to the page as a card: what was sent where, and just the quiz of each. */
    shows,
    cards: () => shows().map((sent) => sent.message.quiz),
    /** The question of the card shown last. */
    lastQuestion: () => shows().at(-1)?.message.quiz.question,
    /** Everything in this device's storage, as a plain object. */
    dump: () => Object.fromEntries([...local.data].map(([key, value]) => [key, structuredClone(value)])),
  };
}

/** Makes `device` the browser the code under test runs in. */
export function use(device) {
  globalThis.chrome = device.chrome;
  return device;
}
