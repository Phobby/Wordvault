// The AI features, in the background script: every request to a model is made from here, with
// the user's own key, for something the user has just asked for by hand. Nothing is sent by
// itself, and nothing goes anywhere but to the provider the user chose.
//
// Before a request goes out, in this order: a provider is set up; the page is not one the
// features are off on; the user has agreed to text being sent to this provider; the browser
// may reach the provider's address. Content scripts never see the key: they are told whether
// a provider is set up and what it is called.

import { WordvaultError } from '../lib/errors.js';
import { tidyPassage } from '../lib/passage.js';
import { resolveTargetLanguage } from '../lib/translator.js';
import { PROMPT_SITES, activeAi, getAiConfig, missing, settingsFor, updateAiConfig } from './config.js';
import { DEFAULT_TIMEOUT_MS } from './http.js';
import { MAX_ANSWER_TOKENS, asOneText, explainPassagePrompt, explainWordPrompt } from './prompts.js';
import { getAiProvider } from './providers/index.js';
import { siteStatus } from './sites.js';

/** Answers kept for this browser session: `ai:<digest>` in storage.session. Never on disk. */
const CACHE_PREFIX = 'ai:';
const CACHE_ENTRIES = 40;
const CACHE_MS = 30 * 60 * 1000;
/** While a request is on its way the browser is given a sign of life this often (see keepAwake). */
const AWAKE_MS = 20_000;

/** requestId -> AbortController of a request under way. */
const underWay = new Map();

function hostOf(sender) {
  try {
    const url = new URL(sender?.url || '');
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.hostname : '';
  } catch {
    return '';
  }
}

const session = () => (typeof chrome !== 'undefined' && chrome.storage?.session ? chrome.storage.session : null);

async function digest(parts) {
  const bytes = new TextEncoder().encode(JSON.stringify(parts));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function recall(key, now = Date.now()) {
  const area = session();
  if (!area) return null;
  const entry = (await area.get(key).catch(() => ({})))[key];
  return entry && typeof entry.text === 'string' && now - entry.at < CACHE_MS && entry.at <= now ? entry.text : null;
}

async function remember(key, text, now = Date.now()) {
  const area = session();
  if (!area) return;
  try {
    await area.set({ [key]: { text, at: now } });
    const all = await area.get(null);
    const mine = Object.entries(all).filter(([name]) => name.startsWith(CACHE_PREFIX)).sort((a, b) => (b[1]?.at || 0) - (a[1]?.at || 0));
    const old = mine.slice(CACHE_ENTRIES).map(([name]) => name);
    if (old.length > 0) await area.remove(old);
  } catch {
    // the session store is full or gone: the answer is simply not kept
  }
}

/** Forgets every kept answer (the switch in the settings was turned off, or the provider changed). */
export async function forgetAnswers() {
  const area = session();
  if (!area) return;
  const all = await area.get(null).catch(() => ({}));
  const mine = Object.keys(all).filter((name) => name.startsWith(CACHE_PREFIX));
  if (mine.length > 0) await area.remove(mine).catch(() => {});
}

/**
 * A browser may stop a background script that has been quiet for half a minute, even with a
 * request on its way. While one is, something small is asked of the browser now and then,
 * which counts as being busy. It ends with the request.
 */
function keepAwake() {
  const timer = setInterval(() => {
    chrome.runtime.getPlatformInfo?.().catch(() => {});
  }, AWAKE_MS);
  return () => clearInterval(timer);
}

async function allowedToReach(provider, settings) {
  const origins = provider.origins(settings);
  if (origins.length === 0) return false;
  return chrome.permissions.contains({ origins }).catch(() => false);
}

/**
 * Sends one prompt to the provider in use.
 * @returns {Promise<string>}
 */
async function ask({ provider, settings, config }, prompt, requestId) {
  const key = CACHE_PREFIX + (await digest([provider.id, settings.model, settings.baseUrl, prompt.task]));
  if (config.cache !== false) {
    const known = await recall(key);
    if (known) return { text: known, cached: true };
  }
  if (!(await allowedToReach(provider, settings))) throw new WordvaultError('ai_permission', '');
  const controller = new AbortController();
  if (requestId) underWay.set(requestId, controller);
  const done = keepAwake();
  try {
    const text = await provider.generate({ system: prompt.system, prompt: prompt.prompt, maxTokens: MAX_ANSWER_TOKENS }, settings, { signal: controller.signal, timeoutMs: provider.timeoutMs || DEFAULT_TIMEOUT_MS });
    if (config.cache !== false) await remember(key, text);
    return { text, cached: false };
  } finally {
    done();
    if (requestId) underWay.delete(requestId);
  }
}

/** What a page may know: whether there is a provider, what it is called, and whether the features are on here. */
async function status(sender) {
  const { config, provider, settings, ready } = await activeAi();
  const site = siteStatus(hostOf(sender), config);
  return {
    ready,
    provider: provider ? { id: provider.id, name: provider.name, model: settings.model } : null,
    /** Text has to go to this provider before the user has said yes to that: ask first. */
    consent: Boolean(provider) && config.consent === provider.id,
    site,
    promptSite: PROMPT_SITES[config.promptSite] ? PROMPT_SITES[config.promptSite].name : PROMPT_SITES.chatgpt.name,
  };
}

/** The prompt for what was asked. The same one is sent to a provider and offered for copying. */
async function buildPrompt(payload) {
  const targetLang = await resolveTargetLanguage();
  const title = typeof payload?.title === 'string' ? payload.title : '';
  if (payload?.kind === 'passage') {
    const text = tidyPassage(payload.text);
    if (!text) throw new WordvaultError('empty');
    const built = explainPassagePrompt({ text, title, targetLang });
    // what decides the answer, without the per-request markers: the key of the session cache
    return { ...built, task: ['passage', text, targetLang] };
  }
  const word = typeof payload?.text === 'string' ? payload.text.trim() : '';
  if (!word) throw new WordvaultError('empty');
  const sentence = typeof payload?.sentence === 'string' ? payload.sentence : '';
  const built = explainWordPrompt({ word, sentence, title, sourceLang: typeof payload?.sourceLang === 'string' ? payload.sourceLang : '', targetLang });
  return { ...built, task: ['word', word, sentence, targetLang] };
}

/**
 * "Explain with AI": a word in its sentence, or a selected passage.
 * @param {{ kind: 'word' | 'passage', text: string, sentence?: string, title?: string, sourceLang?: string, requestId?: string, agree?: boolean }} payload
 *        agree: the user has just said yes to the notice about text being sent.
 */
async function explain(payload, sender) {
  let state = await activeAi();
  if (!state.provider || !state.ready) throw new WordvaultError('ai_not_configured', '');
  const site = siteStatus(hostOf(sender), state.config);
  if (site !== 'ok') throw new WordvaultError('ai_site', site);
  if (state.config.consent !== state.provider.id) {
    if (payload?.agree !== true) throw new WordvaultError('ai_consent', state.provider.name);
    state = { ...state, config: await updateAiConfig({ consent: state.provider.id }) };
  }
  const prompt = await buildPrompt(payload);
  const { text, cached } = await ask(state, prompt, typeof payload?.requestId === 'string' ? payload.requestId : '');
  return { text, cached, provider: { id: state.provider.id, name: state.provider.name, model: state.settings.model } };
}

/** "Test" on the settings page: the settings as they are typed in, one tiny request, nothing kept. */
async function test(payload) {
  const provider = getAiProvider(payload?.provider);
  if (!provider) throw new WordvaultError('ai_not_configured', '');
  const settings = settingsFor(provider, payload?.settings);
  const lacking = missing(provider, settings);
  if (lacking) throw new WordvaultError(`ai_missing_${lacking}`, '');
  if (!(await allowedToReach(provider, settings))) throw new WordvaultError('ai_permission', '');
  const done = keepAwake();
  try {
    const text = await provider.generate({ system: 'You are a connection test. Answer with the single word OK.', prompt: 'Say OK.', maxTokens: MAX_ANSWER_TOKENS }, settings, { timeoutMs: provider.timeoutMs || DEFAULT_TIMEOUT_MS });
    return { ok: true, model: settings.model, sample: text.slice(0, 40) };
  } finally {
    done();
  }
}

/** Only the extension's own pages may ask for these: a content script runs inside a web page. */
function fromOwnPage(handler) {
  return (payload, sender) => {
    if (!String(sender.url || '').startsWith(chrome.runtime.getURL(''))) throw new WordvaultError('internal', 'not allowed from here');
    return handler(payload, sender);
  };
}

/** Message handlers of the AI features, for the background script's table. */
export const aiHandlers = {
  'wv:ai:status': (payload, sender) => status(sender),
  'wv:ai:explain': explain,
  'wv:ai:cancel': (payload) => {
    const controller = underWay.get(payload?.requestId);
    controller?.abort();
    return Boolean(controller);
  },
  // "Copy the prompt and open": the prompt is built here (the same one a provider would get)
  // and handed back for the page to copy. Nothing is sent anywhere.
  'wv:ai:prompt': async (payload) => asOneText(await buildPrompt(payload)),
  // ... and the chat site the user picked in the settings is opened. The address comes from
  // our own fixed list, never from a page or a model.
  'wv:ai:open-site': async () => {
    const config = await getAiConfig();
    const site = PROMPT_SITES[config.promptSite] || PROMPT_SITES.chatgpt;
    await chrome.tabs.create({ url: site.url });
    return site.name;
  },
  'wv:ai:open-settings': async () => {
    await chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html#ai') });
    return true;
  },
  'wv:ai:test': fromOwnPage(test),
  'wv:ai:forget': fromOwnPage(() => forgetAnswers()),
};
