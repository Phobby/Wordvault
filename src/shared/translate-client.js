'use strict';

// Asking for a translation, from wherever a word is picked: a double-click, a word in video
// captions, a word of a screen scan. They all come through here (the bubble calls it), so
// what is done for one is done for all.
//
// In front of the background script's caches this page keeps its own few answers in memory.
// It is the quickest place to look and the first to go: it lasts as long as the page does.
//   1. this Map                      (per page; gone when the page goes)
//   2. chrome.storage.session        (in the background script; gone when the browser closes)
//   3. the lasting cache, seven days (in the background script; storage.local)
//   4. the translation service

(function (WV) {
  if (!WV || WV.translateClient) return;

  /** How many answers a page keeps. The least recently used goes first. */
  const MEMORY_ENTRIES = 200;
  /**
   * An answer in memory is used for this long. After that the background script is asked
   * again, which also tells the lasting cache that the word is still in use.
   */
  const MEMORY_MS = 60 * 60 * 1000;

  /** key -> { at, data }; a Map keeps insertion order, which is the order of use here. */
  const memory = new Map();

  /** Languages whose capital I is not the capital of i. */
  const DOTTED_I = ['tr', 'az'];

  /**
   * One spelling of a text for the caches: case, punctuation around it and Unicode form do
   * not make it another lookup. The same rules as lib/cache-key.js (which this classic script
   * cannot import); a test holds the two to each other.
   */
  function normalizeText(text, lang) {
    let value = String(text == null ? '' : text).normalize('NFC').replace(/\s+/g, ' ').trim();
    const bare = value.replace(/^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu, '');
    if (bare) value = bare;
    const primary = String(lang || '').toLowerCase().split('-')[0];
    if (DOTTED_I.includes(primary)) value = value.replace(/İ/g, 'i').replace(/I/g, 'ı');
    return value.toLowerCase().normalize('NFC');
  }

  /**
   * What decides the answer, as far as this page can tell: the text, the language the user
   * picked (or none), the language of the page, the service asked for this once, and the text
   * around the word (the source language is detected from it). Target language and chosen
   * service are not in the key: the memory is emptied when the settings change.
   */
  function memoryKey(request) {
    // a passage keeps its line breaks and is another request than the same words looked up as a word
    const text = request.passage ? String(request.text) : normalizeText(request.text, request.source);
    return JSON.stringify([text, request.source || '', request.pageLang || '', request.provider || '', request.sample || '', request.passage ? 'passage' : '']);
  }

  function recall(key, now) {
    const entry = memory.get(key);
    if (!entry) return null;
    memory.delete(key);
    if (now - entry.at >= MEMORY_MS || entry.at > now) return null;
    memory.set(key, entry); // used just now: last in line to go
    return entry.data;
  }

  function remember(key, data, now) {
    memory.delete(key);
    memory.set(key, { at: now, data });
    while (memory.size > MEMORY_ENTRIES) memory.delete(memory.keys().next().value);
  }

  /** Requests on their way to the background script: key -> { promise, id, askers }. */
  const pending = new Map();
  let counter = 0;
  /** Unique among the tabs for as long as a request lasts; it identifies nothing else. */
  const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${++counter}`;

  const aborted = () => ({ code: 'aborted', detail: 'given up' });

  /** A passage is translated in pieces; what there is so far is passed on: request id -> listeners. */
  const watching = new Map();
  try {
    chrome.runtime.onMessage.addListener((message, sender) => {
      if (message?.type !== 'wv:passage:progress' || sender.id !== chrome.runtime.id) return;
      for (const listener of watching.get(message.requestId) || []) listener({ done: message.done, total: message.total, translation: message.translation });
    });
  } catch {
    // no messages here: the answer still comes, all at once
  }

  /**
   * @param {{ text: string, sample?: string, pageLang?: string, source?: string | null, provider?: string, fresh?: boolean, passage?: boolean }} request
   *        fresh: "Try again": nothing remembered about a failure is used.
   *        passage: a selected sentence or paragraph rather than a word (lib/translator.js: translatePassage).
   * @param {{ signal?: AbortSignal, onProgress?: (progress: { done: number, total: number, translation: string }) => void }} [options]
   *        onProgress: for a passage, called with what is translated so far.
   *        signal gives the request up: the user moved on to
   *        another word. The promise then rejects with code 'aborted' and what comes back
   *        later is neither shown nor kept.
   * @returns {Promise<Object>} What the background script answers to 'wv:translate'; rejects
   *          with `{ code, detail, context }` like WV.send.
   */
  function translate(request, { signal, onProgress } = {}) {
    if (signal && signal.aborted) return Promise.reject(aborted());
    const key = memoryKey(request);
    if (!request.fresh) {
      const known = recall(key, Date.now());
      if (known) return Promise.resolve({ ...known, from: 'memory' });
    }

    // The same thing is already being asked for from this page: one request, shared.
    let flight = request.fresh ? null : pending.get(key);
    if (!flight) {
      const id = newId();
      flight = { id, askers: 0, promise: null };
      flight.promise = WV.send(request.passage ? 'wv:translate:passage' : 'wv:translate', { ...request, requestId: id }).then(
        (data) => {
          if (pending.get(key) === flight) pending.delete(key);
          // Nobody is waiting any more: it is not kept either. Text that looks damaged is asked for again next time.
          // (Nor is a passage of which only a part could be translated.)
          if (flight.askers > 0 && data && data.translation && data.damaged !== true && !data.partial) remember(key, data, Date.now());
          return data;
        },
        (error) => {
          if (pending.get(key) === flight) pending.delete(key);
          throw error;
        },
      );
      flight.promise.catch(() => {});
      if (!request.fresh) pending.set(key, flight);
    }
    flight.askers += 1;

    const listeners = watching.get(flight.id) || new Set();
    if (onProgress) {
      listeners.add(onProgress);
      watching.set(flight.id, listeners);
    }
    const unwatch = () => {
      listeners.delete(onProgress);
      if (listeners.size === 0) watching.delete(flight.id);
    };

    return new Promise((resolve, reject) => {
      let done = false;
      const giveUp = () => {
        if (done) return;
        done = true;
        unwatch();
        flight.askers -= 1;
        // the last one to leave tells the background script, which stops the request itself
        if (flight.askers <= 0) {
          if (pending.get(key) === flight) pending.delete(key);
          WV.send('wv:translate:cancel', { requestId: flight.id }).catch(() => {});
        }
        reject(aborted());
      };
      if (signal) signal.addEventListener('abort', giveUp, { once: true });
      flight.promise.then(
        (data) => {
          if (done) return;
          done = true;
          unwatch();
          resolve(data);
        },
        (error) => {
          if (done) return;
          done = true;
          unwatch();
          reject(error);
        },
      );
    });
  }

  // Anything that could change an answer empties the memory: the settings (service, target
  // language), a source language pinned for a site, the vault (the answer says whether the
  // word is saved), and "Clear cache" on the settings page.
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      const keys = Object.keys(changes);
      if (keys.some((name) => name === 'settings' || name === 'siteSourceLangs' || name === 'translationCacheEpoch' || name.startsWith('vault:') || name.startsWith('tomb:'))) memory.clear();
    });
  } catch {
    // no storage events here: the memory still ages out
  }

  WV.translateClient = {
    translate,
    /** For tests and for "Clear cache". */
    clear: () => memory.clear(),
    normalizeText,
    size: () => memory.size,
    MEMORY_ENTRIES,
    MEMORY_MS,
  };
})(globalThis.WV);
