// The technical information a piece of feedback may carry, and nothing beyond it: which
// browser and version, which operating system, the extension's version, the language of the
// interface, which features are switched on (yes or no) and the kind of synchronisation.
//
// Never: an address or content of a page, words of the vault, keys, tokens, or anything that
// identifies the user or this installation.

import { getSettings } from '../../lib/settings.js';
import { getSyncConfig } from '../../sync/state.js';

const version = (userAgent, token) => new RegExp(`${token}/([\\d.]+)`).exec(userAgent)?.[1] || '';

/** Brands a Chromium browser lists about itself that say nothing ("Not;A=Brand"), or only the engine. */
const NOT_A_BRAND = /not.{0,3}a.{0,3}brand/i;
const BRAND_NAMES = { 'Microsoft Edge': 'Edge', 'Google Chrome': 'Chrome', 'Opera GX': 'Opera GX' };

/**
 * Which browser this is. Browsers built on another one mostly say they are that one; what
 * tells them apart is used where it exists.
 *
 * @param {Object} clues
 * @param {string} [clues.userAgent]
 * @param {{ brand: string, version: string }[]} [clues.brands]  navigator.userAgentData.brands (Chromium only).
 * @param {{ name?: string, version?: string } | null} [clues.browserInfo]  runtime.getBrowserInfo() (Gecko only).
 * @param {boolean} [clues.brave]  navigator.brave exists.
 * @returns {{ browser: string, browserVersion: string, engine: string }}
 */
export function detectBrowser({ userAgent = '', brands = [], browserInfo = null, brave = false } = {}) {
  const firefox = version(userAgent, 'Firefox');
  if (browserInfo?.name || firefox) {
    // Gecko: the browser names itself (Firefox, Zen, LibreWolf, Waterfox…) with its own version.
    const name = browserInfo?.name || 'Firefox';
    return { browser: name, browserVersion: browserInfo?.version || firefox, engine: firefox ? `Gecko ${firefox}` : 'Gecko' };
  }
  const chromium = version(userAgent, 'Chrome') || brands.find((entry) => entry.brand === 'Chromium')?.version || '';
  const engine = chromium ? `Chromium ${chromium}` : '';
  const named = brands.find((entry) => !NOT_A_BRAND.test(entry.brand) && entry.brand !== 'Chromium');
  if (brave || named?.brand === 'Brave') return { browser: 'Brave', browserVersion: named?.brand === 'Brave' ? named.version : chromium, engine };
  // Some say it only in the user agent.
  for (const [token, name] of [['Edg', 'Edge'], ['OPR', 'Opera'], ['Vivaldi', 'Vivaldi'], ['YaBrowser', 'Yandex']]) {
    const found = version(userAgent, token);
    if (found) return { browser: name, browserVersion: found, engine };
  }
  if (named) return { browser: BRAND_NAMES[named.brand] || named.brand, browserVersion: named.version, engine };
  if (chromium) return { browser: 'Chromium', browserVersion: chromium, engine };
  const safari = version(userAgent, 'Version');
  return /Safari\//.test(userAgent) && safari ? { browser: 'Safari', browserVersion: safari, engine: 'WebKit' } : { browser: 'unknown', browserVersion: '', engine: '' };
}

const OS_NAMES = { mac: 'macOS', win: 'Windows', linux: 'Linux', android: 'Android', cros: 'ChromeOS', openbsd: 'OpenBSD', fuchsia: 'Fuchsia' };

/**
 * Which features are on, as yes or no and nothing more.
 * @param {Object} settings  lib/settings.js
 * @param {Object} syncConfig  sync/state.js
 */
export function featureFlags(settings, syncConfig) {
  return {
    doubleClick: Boolean(settings.doubleClick),
    quiz: Boolean(settings.quizEnabled),
    ttsFallback: Boolean(settings.ttsFallback),
    ocrRememberArea: Boolean(settings.ocrRememberArea),
    ocrShowBoxes: Boolean(settings.ocrShowBoxes),
    sync: syncConfig.mode !== 'off',
    syncEncryption: Boolean(syncConfig.encryption?.enabled),
  };
}

/** Collects the information from this browser. Called from a page of the extension. */
export async function collectTechInfo() {
  const [browserInfo, platform, settings, syncConfig] = await Promise.all([
    typeof chrome.runtime.getBrowserInfo === 'function' ? chrome.runtime.getBrowserInfo().catch(() => null) : null,
    chrome.runtime.getPlatformInfo().catch(() => null),
    getSettings(),
    getSyncConfig(),
  ]);
  const detected = detectBrowser({
    userAgent: navigator.userAgent,
    brands: navigator.userAgentData?.brands || [],
    browserInfo,
    brave: typeof navigator.brave?.isBrave === 'function',
  });
  return {
    ...detected,
    // ASSUMPTION: the name of the operating system is enough; its exact version is not collected.
    os: OS_NAMES[platform?.os] || platform?.os || 'unknown',
    extensionVersion: chrome.runtime.getManifest().version,
    uiLanguage: chrome.i18n.getUILanguage(),
    features: featureFlags(settings, syncConfig),
    // the kind only ('off', 'browser', 'cloud', 'server'): not which service, not which account
    syncMode: syncConfig.mode,
  };
}
