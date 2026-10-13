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

  /**
   * What decides the answer, as far as this page can tell: the text, the language the user
   * picked (or none), the language of the page, the service asked for this once, and the text
   * around the word (the source language is detected from it). Target language and chosen
   * service are not in the key: the memory is emptied when the settings change.
   */
  function memoryKey(request) {
    return JSON.stringify([String(request.text || '').replace(/\s+/g, ' ').trim(), request.source || '', request.pageLang || '', request.provider || '', request.sample || '']);
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

  /**
   * @param {{ text: string, sample?: string, pageLang?: string, source?: string | null, provider?: string }} request
   * @returns {Promise<Object>} What the background script answers to 'wv:translate'; rejects
   *          with `{ code, detail, context }` like WV.send.
   */
  async function translate(request) {
    const key = memoryKey(request);
    const now = Date.now();
    const known = recall(key, now);
    if (known) return { ...known, from: 'memory' };
    const data = await WV.send('wv:translate', request);
    // What may differ next time is not kept: text that looks damaged is asked for again.
    if (data && data.translation && data.damaged !== true) remember(key, data, Date.now());
    return data;
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
    size: () => memory.size,
    MEMORY_ENTRIES,
    MEMORY_MS,
  };
})(globalThis.WV);
