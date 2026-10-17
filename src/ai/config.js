// What the user set up for the AI features: which provider, its key, model and address, the
// site lists, and whether they have agreed to text being sent.
//
// It lives under its own key in chrome.storage.local. It travels with the other settings
// (sync/prefs.js), without the consents; the keys only inside an encrypted synchronised document
// or a backup file the user asked to include them in. Never in feedback or any cache
// (tests/ai-safety.test.js, tests/sync-prefs.test.js). The key never leaves the background
// script and the settings page otherwise: content scripts are told only whether a provider is
// set up, never with what.

import { getAiProvider } from './providers/index.js';
import { parseBase } from './providers/shared.js';
import { toHostList } from './sites.js';

export const AI_CONFIG_KEY = 'aiConfig';

/** Where "Copy the prompt and open" can take the user. Fixed addresses: nothing here comes from a page or a model. */
export const PROMPT_SITES = Object.freeze({
  chatgpt: { name: 'ChatGPT', url: 'https://chatgpt.com/' },
  claude: { name: 'Claude', url: 'https://claude.ai/new' },
  gemini: { name: 'Gemini', url: 'https://gemini.google.com/app' },
});

export const DEFAULT_AI_CONFIG = Object.freeze({
  /** Id of the one active provider; '' while the AI features are off. */
  provider: '',
  /** Per provider: { apiKey, model, baseUrl }. Kept when another provider is chosen. */
  providers: {},
  /** The provider the user has agreed to send text to ('' = not yet). Asked again for another one. */
  consent: '',
  /** Keep answers for this browser session, so the same question is not sent twice. */
  cache: true,
  /** Hosts the AI features are off on, in addition to the built-in ones (ai/sites.js). */
  blocked: [],
  /** Hosts the AI features are on, although the built-in list would switch them off. */
  allowed: [],
  /** Which site "Copy the prompt and open" opens: a key of PROMPT_SITES. */
  promptSite: 'chatgpt',
  /** The provider the user has agreed to send pictures to ("Ask about the image"); asked apart from text. */
  imageConsent: '',
  /** The provider the user has agreed to send vault words and their translations to ("Create a test with AI"); asked apart from page text. */
  examConsent: '',
  /** Which models read pictures, as found out by trying (ai/vision.js): { 'provider|model|address': boolean }. */
  vision: {},
});

const clean = (value, max = 300) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/** @returns {Promise<typeof DEFAULT_AI_CONFIG>} */
export async function getAiConfig() {
  const stored = (await chrome.storage.local.get(AI_CONFIG_KEY))[AI_CONFIG_KEY];
  const config = { ...DEFAULT_AI_CONFIG, ...(stored && typeof stored === 'object' ? stored : {}) };
  config.providers = config.providers && typeof config.providers === 'object' ? config.providers : {};
  // Arrays of hosts; a list kept as text (one host per line) is read as one, blank lines and duplicates dropped.
  config.blocked = toHostList(config.blocked);
  config.allowed = toHostList(config.allowed);
  config.vision = config.vision && typeof config.vision === 'object' ? config.vision : {};
  return config;
}

let turns = Promise.resolve();

/** @param {Partial<typeof DEFAULT_AI_CONFIG>} patch  Changes take turns, like the settings' (lib/settings.js). */
export function updateAiConfig(patch) {
  const done = turns.then(async () => {
    const next = { ...(await getAiConfig()), ...patch };
    await chrome.storage.local.set({ [AI_CONFIG_KEY]: next });
    return next;
  });
  turns = done.catch(() => {});
  return done;
}

/**
 * A provider's settings as they are used: what the user typed, with the provider's defaults
 * where they typed nothing.
 * @returns {import('./providers/index.js').AiSettings}
 */
export function settingsFor(provider, stored) {
  return {
    apiKey: clean(stored?.apiKey, 400),
    model: clean(stored?.model, 120) || provider.defaultModel,
    baseUrl: provider.needsBase ? clean(stored?.baseUrl) || provider.defaultBase : '',
  };
}

/** Why a provider cannot be used as it is set up: 'key', 'model', 'address', or '' if it can. */
export function missing(provider, settings) {
  if (provider.needsKey && !settings.apiKey) return 'key';
  if (provider.needsBase && !parseBase(settings.baseUrl)) return 'address';
  if (!settings.model) return 'model';
  return '';
}

/**
 * The provider in use and its settings, or the reason there is none.
 * @param {typeof DEFAULT_AI_CONFIG} [config]
 * @returns {Promise<{ config: typeof DEFAULT_AI_CONFIG, provider: import('./providers/index.js').AiProvider | null, settings: import('./providers/index.js').AiSettings | null, ready: boolean }>}
 */
export async function activeAi(config) {
  const current = config || (await getAiConfig());
  const provider = getAiProvider(current.provider);
  if (!provider) return { config: current, provider: null, settings: null, ready: false };
  const settings = settingsFor(provider, current.providers[provider.id]);
  return { config: current, provider, settings, ready: missing(provider, settings) === '' };
}
