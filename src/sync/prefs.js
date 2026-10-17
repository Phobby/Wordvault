// The user's settings, as they travel with the vault: in the synchronised document (section `p`)
// and in the backup file. One section for all of them, the newest edit wins as a whole.
//
//   { u, settings, ui, ai, sites, keys? }
//
//   u         when the settings were last edited on any device (ms; see PREFS_STAMP_KEY)
//   settings  lib/settings.js, without the DeepL key
//   ui        the interface language chosen ('' = the browser's)
//   ai        ai/config.js, without the API keys, the consents and what was found out about models
//   sites     "always use this source language on this site"
//   keys      { deepl?: string, ai?: { <provider>: string } }: the API keys. Only where the user
//             agreed to that: in an encrypted synchronised document, or a backup file made with
//             "include API keys". Never in a document stored unencrypted.
//
// The consents ("send text to this provider") stay on each device: agreeing is asked again on a
// device that has not been asked. A key that a document does not carry is never removed here;
// a key emptied on purpose ('') is carried and empties it elsewhere too.

import { canonical } from './canonical.js';
import { AI_CONFIG_KEY, getAiConfig } from '../ai/config.js';
import { DEFAULT_SETTINGS, migrateSettings } from '../lib/settings.js';

/** When this device's settings were last edited (ms), and the fingerprint of what was synchronised then. */
export const PREFS_STAMP_KEY = 'prefsUpdatedAt';
export const PREFS_HASH_KEY = 'prefsHash';
/** Where the parts are stored on the device. */
const SETTINGS_KEY = 'settings';
const UI_KEY = 'uiLanguage';
const SITES_KEY = 'siteSourceLangs';
/** The storage keys whose change is an edit of the settings. */
export const PREFS_STORAGE_KEYS = Object.freeze([SETTINGS_KEY, UI_KEY, SITES_KEY, AI_CONFIG_KEY]);

/** Parts of the AI configuration that belong to this device only. */
const AI_LOCAL_ONLY = ['consent', 'imageConsent', 'examConsent', 'vision'];

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const strings = (value) => (isObject(value) ? Object.fromEntries(Object.entries(value).filter(([, item]) => typeof item === 'string')) : {});

/** The settings of this device as one section (`keys` always filled; the caller drops them where they must not go). */
export async function readPrefs() {
  const stored = await chrome.storage.local.get([SETTINGS_KEY, UI_KEY, SITES_KEY, AI_CONFIG_KEY, PREFS_STAMP_KEY]);
  const settings = { ...DEFAULT_SETTINGS, ...migrateSettings(stored[SETTINGS_KEY]) };
  const deepl = settings.providerConfig?.deepl?.apiKey;
  const providerConfig = Object.fromEntries(Object.entries(isObject(settings.providerConfig) ? settings.providerConfig : {}).map(([id, config]) => [id, Object.fromEntries(Object.entries(isObject(config) ? config : {}).filter(([key]) => key !== 'apiKey'))]));
  const config = await getAiConfig();
  const ai = Object.fromEntries(Object.entries(config).filter(([key]) => !AI_LOCAL_ONLY.includes(key)));
  ai.providers = Object.fromEntries(Object.entries(config.providers).map(([id, values]) => [id, Object.fromEntries(Object.entries(isObject(values) ? values : {}).filter(([key]) => key !== 'apiKey'))]));
  const aiKeys = Object.fromEntries(Object.entries(config.providers).filter(([, values]) => typeof values?.apiKey === 'string').map(([id, values]) => [id, values.apiKey]));
  // Settings that were never edited since this was added are older than any edit: 1, not 0
  // (0 is "nothing here"), so that a device that never had settings takes the others'.
  const customised = Boolean(stored[SETTINGS_KEY] || stored[AI_CONFIG_KEY] || stored[UI_KEY] || stored[SITES_KEY]);
  return {
    u: Number(stored[PREFS_STAMP_KEY]) || (customised ? 1 : 0),
    settings: { ...settings, providerConfig },
    ui: typeof stored[UI_KEY] === 'string' ? stored[UI_KEY] : '',
    ai,
    sites: isObject(stored[SITES_KEY]) ? stored[SITES_KEY] : {},
    keys: { ...(typeof deepl === 'string' ? { deepl } : {}), ai: aiKeys },
  };
}

/** The same section without the API keys. */
export function withoutKeys(prefs) {
  if (!prefs) return prefs;
  const { keys, ...rest } = prefs;
  return rest;
}

/** What identifies an edit: everything but the time. */
export const prefsFingerprint = (prefs) => canonical({ ...prefs, u: 0 });

/**
 * A section that came from outside (the cloud, a file), checked; null if it is not one.
 * Values are cleaned again when they are used (lib/settings.js, ai/config.js).
 */
export function normalizePrefs(raw) {
  if (!isObject(raw) || !Number.isFinite(raw.u) || raw.u < 0 || !isObject(raw.settings) || !isObject(raw.ai)) return null;
  const prefs = { u: raw.u, settings: raw.settings, ui: typeof raw.ui === 'string' ? raw.ui.slice(0, 35) : '', ai: raw.ai, sites: isObject(raw.sites) ? raw.sites : {} };
  if (isObject(raw.keys)) prefs.keys = { ...(typeof raw.keys.deepl === 'string' ? { deepl: raw.keys.deepl } : {}), ai: strings(raw.keys.ai) };
  return prefs;
}

/**
 * The newer of two sections (the later edit; equal times: the canonical text decides, so every
 * device picks the same). Keys the newer one does not carry are taken from the other: a device
 * that never had a key must not make the others forget theirs.
 */
export function mergePrefs(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  const order = a.u !== b.u ? a.u - b.u : prefsFingerprint(a) < prefsFingerprint(b) ? -1 : prefsFingerprint(a) > prefsFingerprint(b) ? 1 : 0;
  const [newer, older] = order >= 0 ? [a, b] : [b, a];
  if (!newer.keys && !older.keys) return newer;
  const keys = { ...(older.keys || {}), ...(newer.keys || {}), ai: { ...(older.keys?.ai || {}), ...(newer.keys?.ai || {}) } };
  return { ...newer, keys };
}

/**
 * Makes this device's settings those of `prefs` (newer than what the device has, or a backup
 * being restored). Keys `prefs` does not carry stay as they are on the device.
 * @param {{ stamp?: number }} [options]  stamp: the edit time to record (default: the section's).
 */
export async function applyPrefs(prefs, { stamp = prefs.u } = {}) {
  const stored = await chrome.storage.local.get([SETTINGS_KEY, AI_CONFIG_KEY]);
  const current = isObject(stored[SETTINGS_KEY]) ? stored[SETTINGS_KEY] : {};
  const deepl = typeof prefs.keys?.deepl === 'string' ? prefs.keys.deepl : current.providerConfig?.deepl?.apiKey;
  const providerConfig = { ...(isObject(prefs.settings.providerConfig) ? prefs.settings.providerConfig : {}) };
  if (typeof deepl === 'string') providerConfig.deepl = { ...(isObject(providerConfig.deepl) ? providerConfig.deepl : {}), apiKey: deepl };
  const settings = migrateSettings({ ...prefs.settings, providerConfig });

  const config = await getAiConfig();
  const providers = {};
  for (const id of new Set([...Object.keys(config.providers), ...Object.keys(isObject(prefs.ai.providers) ? prefs.ai.providers : {})])) {
    const incoming = isObject(prefs.ai.providers?.[id]) ? prefs.ai.providers[id] : null;
    const base = incoming ? { ...incoming } : { ...(config.providers[id] || {}) };
    const key = typeof prefs.keys?.ai?.[id] === 'string' ? prefs.keys.ai[id] : config.providers[id]?.apiKey;
    if (typeof key === 'string') base.apiKey = key;
    else delete base.apiKey;
    providers[id] = base;
  }
  const local = Object.fromEntries(AI_LOCAL_ONLY.filter((key) => key in config).map((key) => [key, config[key]]));
  const ai = { ...prefs.ai, ...local, providers };

  await chrome.storage.local.set({ [SETTINGS_KEY]: settings, [UI_KEY]: prefs.ui, [SITES_KEY]: prefs.sites, [AI_CONFIG_KEY]: ai, [PREFS_STAMP_KEY]: stamp });
  // What the device holds now counts as synchronised: its next edit is a new one.
  await chrome.storage.local.set({ [PREFS_HASH_KEY]: prefsFingerprint(await readPrefs()) });
}

/**
 * The settings were changed on this device (by the user, or by something applied from outside).
 * Records the time of an edit, if it is one: the content differs from what was last recorded.
 * @returns {Promise<boolean>} Whether it was an edit (something to synchronise).
 */
export async function notePrefsChange(now = Date.now()) {
  const prefs = await readPrefs();
  const fingerprint = prefsFingerprint(prefs);
  const { [PREFS_HASH_KEY]: known } = await chrome.storage.local.get(PREFS_HASH_KEY);
  if (known === fingerprint) return false;
  await chrome.storage.local.set({ [PREFS_STAMP_KEY]: now, [PREFS_HASH_KEY]: fingerprint });
  return true;
}
