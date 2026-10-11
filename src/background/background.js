// Background entry point: a service worker in Chrome, an event page in Firefox. Both can be
// stopped at any time, so nothing is kept in module-level state and every listener is registered
// synchronously at the top level.
//
// All network requests are made from here. Content scripts cannot do it themselves: their
// requests would be subject to the CORS and CSP rules of whatever page they run in.

import { lookupWord } from '../lib/dictionary.js';
import { WordvaultError, serializeError } from '../lib/errors.js';
import { getPreferences, setSiteSourceLanguage, setTargetLanguage, translate } from '../lib/translator.js';
import { addEntry, entryId, getEntry, hasEntry, removeEntry, updateEntry } from '../lib/vault.js';

/** Host name of the web page a message came from ('' for extension pages). */
function hostOf(sender) {
  try {
    const url = new URL(sender.url || '');
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.hostname : '';
  } catch {
    return '';
  }
}

/**
 * A translation plus whether the word is already in the vault. A failed translation reports the
 * same thing (in the error's context), because the word can still be saved without one.
 */
async function lookup(payload, sender) {
  try {
    const result = await translate(payload, hostOf(sender));
    return { ...result, saved: await hasEntry(entryId(result)) };
  } catch (error) {
    if (error instanceof WordvaultError && error.context) {
      error.context.saved = await hasEntry(entryId(error.context));
    }
    throw error;
  }
}

/**
 * Fetches word types, definitions and examples for a vault entry that does not have them yet.
 * @returns {Promise<object | null>} The entry as stored afterwards (unchanged if the request failed).
 */
async function enrich(id) {
  const entry = await getEntry(id);
  if (!entry || entry.dictionary) return entry;
  try {
    return await updateEntry(id, { dictionary: await lookupWord(entry.text, entry.sourceLang) });
  } catch {
    return entry; // offline or rate-limited: the vault popup asks again when the word is opened
  }
}

async function save(payload) {
  const entry = await addEntry(payload);
  enrich(entry.id).catch(() => {}); // not awaited: saving does not wait for Wiktionary
  return entry;
}

/** Message handlers, keyed by message type. Each returns (a promise of) the response data. */
const handlers = {
  'wv:translate': lookup,
  'wv:prefs': (payload, sender) => getPreferences(hostOf(sender)),
  'wv:setTargetLang': (payload) => setTargetLanguage(payload?.code),
  'wv:setSiteSource': (payload, sender) => setSiteSourceLanguage(hostOf(sender), payload?.lang),
  'wv:vault:add': save,
  'wv:vault:enrich': (payload) => enrich(payload?.id),
  'wv:vault:remove': (payload) => removeEntry(entryId(payload || {})),
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = handlers[message?.type];
  if (!handler || sender.id !== chrome.runtime.id) return false;
  Promise.resolve()
    .then(() => handler(message.payload, sender))
    .then(
      (data) => sendResponse({ ok: true, data }),
      (error) => sendResponse({ ok: false, error: serializeError(error) }),
    );
  return true; // keep the channel open for the asynchronous response
});
