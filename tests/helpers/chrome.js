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
 * @param {string} [name]
 * @param {{ uiLanguage?: string, detect?: (text: string) => string | null }} [options]
 *   `detect` plays the browser's language detector: it returns a language code, or null for
 *   "cannot tell". Every text it is asked about is recorded in `detected`.
 */
export function createDevice(name = 'device', { uiLanguage = 'en-US', detect = () => null } = {}) {
  const local = storageArea();
  const detected = [];
  const i18n = {
    getUILanguage: () => uiLanguage,
    detectLanguage: async (text) => {
      detected.push(text);
      const language = detect(text);
      return language ? { isReliable: true, languages: [{ language, percentage: 100 }] } : { isReliable: false, languages: [] };
    },
  };
  // The browser around the extension, as far as the quiz timer is concerned. Tests change
  // these fields to set a scene: no tab, window in the background, a page that says "not now".
  const browser = {
    /** The active tab, or null. */
    tab: { id: 1, windowId: 1, active: true, audible: false },
    focused: true,
    /** What the page answers to a message; throw to play a page extensions cannot run on. */
    reply: () => ({ shown: true }),
    /** Messages delivered to the tab. */
    sent: [],
  };
  const alarmMap = new Map();
  const alarms = {
    get: async (alarmName) => alarmMap.get(alarmName),
    create: async (alarmName, info) => {
      alarmMap.set(alarmName, { name: alarmName, scheduledTime: info.when ?? Date.now() + (info.delayInMinutes || 0) * 60_000 });
    },
    clear: async (alarmName) => alarmMap.delete(alarmName),
  };
  const tabs = {
    query: async () => (browser.tab ? [browser.tab] : []),
    sendMessage: async (tabId, message, options) => {
      browser.sent.push({ tabId, message, options });
      return browser.reply(message);
    },
  };
  const windows = { get: async (id) => ({ id, focused: browser.focused }) };
  return {
    name,
    local,
    detected,
    browser,
    /** Name -> time of every alarm that is set. */
    alarmTimes: () => Object.fromEntries([...alarmMap].map(([alarmName, alarm]) => [alarmName, alarm.scheduledTime])),
    /** A browser restart, as far as timers go: alarms are gone, storage stays. */
    forgetAlarms: () => alarmMap.clear(),
    chrome: { storage: { local }, i18n, alarms, tabs, windows, runtime: { getManifest: () => ({ version: '0.0.0-test' }) } },
    /** Everything in this device's storage, as a plain object. */
    dump: () => Object.fromEntries([...local.data].map(([key, value]) => [key, structuredClone(value)])),
  };
}

/** Makes `device` the browser the code under test runs in. */
export function use(device) {
  globalThis.chrome = device.chrome;
  return device;
}
