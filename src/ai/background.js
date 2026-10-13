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
import { PAGE_ANSWER_TOKENS, PAGE_CHUNK_CHARS, PAGE_CHUNK_ITEMS, PAGE_MAX_CHARS, parsePageTranslation, tidyItems } from './page-translate.js';
import { MAX_ANSWER_TOKENS, asOneText, explainPassagePrompt, explainWordPrompt, pageTranslatePrompt, summaryJoinPrompt, summaryPartPrompt, summaryPrompt } from './prompts.js';
import { getAiProvider } from './providers/index.js';
import { siteStatus } from './sites.js';
import { PART_SUMMARY_CHARS, lengthOf, planSummary } from './summary.js';

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
 * @param {string | AbortController} request  The id under which the request can be cancelled
 *        (wv:ai:cancel), or the controller of a task that is made of several requests.
 * @returns {Promise<{ text: string, cached: boolean }>}
 */
async function ask({ provider, settings, config }, prompt, request) {
  const key = CACHE_PREFIX + (await digest([provider.id, settings.model, settings.baseUrl, prompt.task]));
  if (config.cache !== false) {
    const known = await recall(key);
    if (known) return { text: known, cached: true };
  }
  if (!(await allowedToReach(provider, settings))) throw new WordvaultError('ai_permission', '');
  const own = typeof request === 'string' || !request;
  const controller = own ? new AbortController() : request;
  if (own && request) underWay.set(request, controller);
  const done = keepAwake();
  try {
    const text = await provider.generate({ system: prompt.system, prompt: prompt.prompt, maxTokens: prompt.maxTokens || MAX_ANSWER_TOKENS }, settings, { signal: controller.signal, timeoutMs: provider.timeoutMs || DEFAULT_TIMEOUT_MS });
    if (config.cache !== false) await remember(key, text);
    return { text, cached: false };
  } finally {
    done();
    if (own && request) underWay.delete(request);
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
 * What has to hold before text goes to a provider, in this order: one is set up; the page is
 * not one the features are off on; the user has agreed to text being sent to this provider.
 * @param {{ agree?: boolean }} payload  agree: the user has just said yes to the notice.
 */
async function cleared(payload, sender) {
  const state = await activeAi();
  if (!state.provider || !state.ready) throw new WordvaultError('ai_not_configured', '');
  const site = siteStatus(hostOf(sender), state.config);
  if (site !== 'ok') throw new WordvaultError('ai_site', site);
  if (state.config.consent === state.provider.id) return state;
  if (payload?.agree !== true) throw new WordvaultError('ai_consent', state.provider.name);
  return { ...state, config: await updateAiConfig({ consent: state.provider.id }) };
}

const named = (state) => ({ id: state.provider.id, name: state.provider.name, model: state.settings.model });

/**
 * "Explain with AI": a word in its sentence, or a selected passage.
 * @param {{ kind: 'word' | 'passage', text: string, sentence?: string, title?: string, sourceLang?: string, requestId?: string, agree?: boolean }} payload
 *        agree: the user has just said yes to the notice about text being sent.
 */
async function explain(payload, sender) {
  const state = await cleared(payload, sender);
  const prompt = await buildPrompt(payload);
  const { text, cached } = await ask(state, prompt, typeof payload?.requestId === 'string' ? payload.requestId : '');
  return { text, cached, provider: named(state) };
}

// --- Summarise this page -----------------------------------------------------------------------

/**
 * What a summary of this text would send, for the page to show before the user agrees.
 * Nothing is sent to find this out.
 * @param {{ text: string }} payload
 */
async function summaryPlan(payload, sender) {
  const state = await activeAi();
  const plan = planSummary(payload?.text, state.provider);
  return {
    ...(await status(sender)),
    chars: plan.chars,
    total: plan.total,
    truncated: plan.truncated,
    parts: plan.parts.length,
    requests: plan.requests,
    length: lengthOf(state.config.summaryLength),
  };
}

/**
 * "Summarise this page": the page's main text, in one request or, if it is long, part by part.
 * @param {{ text: string, title?: string, length?: string, requestId?: string, agree?: boolean }} payload
 */
async function summarize(payload, sender) {
  const state = await cleared(payload, sender);
  const plan = planSummary(payload?.text, state.provider);
  if (plan.parts.length === 0) throw new WordvaultError('empty');
  const length = lengthOf(payload?.length);
  if (lengthOf(state.config.summaryLength) !== length) await updateAiConfig({ summaryLength: length }); // offered again next time
  const title = typeof payload?.title === 'string' ? payload.title : '';
  const targetLang = await resolveTargetLanguage();
  const requestId = typeof payload?.requestId === 'string' ? payload.requestId : '';
  const controller = new AbortController();
  if (requestId) underWay.set(requestId, controller);
  /** Tells the page how far it is: `done` of `total` requests have been answered. */
  const tell = (done) => {
    if (sender?.tab?.id == null || !requestId) return;
    chrome.tabs.sendMessage(sender.tab.id, { type: 'wv:summary:progress', requestId, done, total: plan.requests }, { frameId: sender.frameId || 0 }).catch(() => {});
  };
  /** One request of the task; "Cancel" stops the one under way and none follows it. */
  const step = async (prompt) => {
    if (controller.signal.aborted) throw new WordvaultError('aborted');
    return (await ask(state, prompt, controller)).text;
  };
  try {
    let text;
    if (plan.parts.length === 1) {
      text = await step({ ...summaryPrompt({ text: plan.parts[0], title, targetLang, length }), task: ['summary', plan.parts[0], title, targetLang, length] });
    } else {
      const notes = [];
      for (const [index, part] of plan.parts.entries()) {
        // (the notes on a part do not depend on the length asked for: another length reuses them)
        const note = await step({ ...summaryPartPrompt({ text: part, title, part: index + 1, parts: plan.parts.length, targetLang }), task: ['summary-part', part, title, index + 1, plan.parts.length, targetLang] });
        notes.push(note.slice(0, PART_SUMMARY_CHARS));
        tell(index + 1);
      }
      text = await step({ ...summaryJoinPrompt({ notes, title, targetLang, length }), task: ['summary-join', notes, title, targetLang, length] });
    }
    return { text, provider: named(state), parts: plan.parts.length, chars: plan.chars, truncated: plan.truncated, length };
  } finally {
    if (requestId) underWay.delete(requestId);
  }
}

// --- Translate this page -----------------------------------------------------------------------

/** How a page is to cut its text for the provider in use, for it to show before the user agrees. Nothing is sent. */
async function pagePlan(payload, sender) {
  const state = await activeAi();
  return {
    ...(await status(sender)),
    chunkChars: Math.max(500, Number(state.provider?.pageChunkChars) || PAGE_CHUNK_CHARS),
    chunkItems: PAGE_CHUNK_ITEMS,
    maxChars: PAGE_MAX_CHARS,
    targetLang: await resolveTargetLanguage(),
  };
}

/**
 * One chunk of a page's visible text. The page asks chunk by chunk, after the user has seen
 * how much there is and started it; every chunk passes the same gates again.
 * @param {{ items: (string | string[])[], title?: string, requestId?: string, agree?: boolean }} payload
 * @returns {Promise<{ items: (string | string[] | null)[], provider: object }>}
 */
async function translateChunk(payload, sender) {
  const state = await cleared(payload, sender);
  const chunkChars = Math.max(500, Number(state.provider.pageChunkChars) || PAGE_CHUNK_CHARS);
  const items = tidyItems(payload?.items, chunkChars * 3);
  const title = typeof payload?.title === 'string' ? payload.title : '';
  const targetLang = await resolveTargetLanguage();
  const prompt = { ...pageTranslatePrompt({ items, title, targetLang }), task: ['page', items, targetLang], maxTokens: PAGE_ANSWER_TOKENS };
  const { text } = await ask(state, prompt, typeof payload?.requestId === 'string' ? payload.requestId : '');
  return { items: parsePageTranslation(text, items), provider: named(state) };
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
  'wv:ai:summary:plan': summaryPlan,
  'wv:ai:summarize': summarize,
  'wv:ai:page:plan': pagePlan,
  'wv:ai:page:chunk': translateChunk,
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
