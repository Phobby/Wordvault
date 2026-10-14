'use strict';

// The interface language. Wordvault does not use chrome.i18n for its interface: that ties the
// language to the browser's and cannot be changed while the extension runs. Its strings live
// in src/locales/<code>.json instead (flat key -> message; English is the source and the
// fallback), and the user picks the language in the settings. src/_locales is only for what
// the browser itself shows in the store and on its extension pages (name, description,
// shortcut descriptions); see CONTRIBUTING-TRANSLATIONS.md.
//
// One file for every context: content scripts and the extension's pages load it as a classic
// script, the background script imports it for its side effect, and tests do either. Nothing
// here touches the DOM.
//
// How the strings get to a context:
//   - The chosen language is stored under `uiLanguage` ('' = follow the browser).
//   - The strings of that language, with English filled in where a key is missing, are kept
//     under `i18nCache` in storage.local, so that a content script gets them with one read and
//     no file access. Only that one language is in it.
//   - Whoever can read the extension's files (its pages, the background script) builds that
//     entry when it is missing or stale; a content script asks the background script to.
//   - Every context listens for changes of `i18nCache` and switches at once (onChange).
//
// Message format: "{name}" is replaced by the value of that name; numbers are formatted for
// the language (Intl.NumberFormat). "{count, plural, one {# word} other {# words}}" picks a
// form with Intl.PluralRules ("=0 {...}" for an exact number); "#" is the formatted number.

globalThis.WV = globalThis.WV || {};

(function (WV) {
  if (WV.i18n) return;

  /** Set to false by `node build.js --release`: missing keys are then not reported on the console. */
  const DEV = true;

  /**
   * The interface languages: the one place a language is added (with its file in src/locales).
   * `name` is the language's name in the language itself, as the settings list shows it.
   */
  const LANGUAGES = Object.freeze([
    { code: 'en', name: 'English' },
    { code: 'tr', name: 'Türkçe' },
  ]);
  const SOURCE = 'en';
  /** Languages written right to left (ready for those not offered yet). */
  const RTL = new Set(['ar', 'he', 'fa', 'ur', 'ps', 'sd', 'yi', 'dv', 'ug', 'ckb']);
  const CHOICE_KEY = 'uiLanguage';
  const CACHE_KEY = 'i18nCache';

  const state = {
    /** The language in use. */
    lang: SOURCE,
    /** The extension version its strings came with. */
    version: '',
    /** key -> message: the language's own, with English where it has none. */
    messages: {},
    loaded: false,
    /** Whether a text was asked for before the strings were there (it then showed its key). */
    early: false,
  };
  const listeners = new Set();
  const warned = new Set();
  const plurals = new Map();
  const numbers = new Map();

  const supported = (code) => LANGUAGES.some((language) => language.code === code);

  /**
   * The language to use: the user's choice if it is offered, otherwise the browser's language
   * if it is offered (exactly, or by its main part: "pt-PT" finds "pt-BR"), otherwise English.
   */
  function resolve(choice, browserLanguage) {
    if (choice && supported(choice)) return choice;
    const wanted = String(browserLanguage || '').replace('_', '-').toLowerCase();
    const exact = LANGUAGES.find((language) => language.code.toLowerCase() === wanted);
    if (exact) return exact.code;
    const primary = wanted.split('-')[0];
    return LANGUAGES.find((language) => language.code.split('-')[0].toLowerCase() === primary)?.code || SOURCE;
  }

  function browserLanguage() {
    try {
      return chrome.i18n.getUILanguage();
    } catch {
      return globalThis.navigator?.language || SOURCE;
    }
  }

  // --- Formatting --------------------------------------------------------------------------------

  function number(value, lang = state.lang) {
    if (!numbers.has(lang)) numbers.set(lang, new Intl.NumberFormat(lang));
    return numbers.get(lang).format(value);
  }

  const shown = (value, lang) => (typeof value === 'number' && Number.isFinite(value) ? number(value, lang) : String(value ?? ''));

  /** The text between a "{" at `start` and its matching "}", and where that ends. */
  function block(text, start) {
    let depth = 0;
    for (let i = start; i < text.length; i += 1) {
      if (text[i] === '{') depth += 1;
      else if (text[i] === '}') {
        depth -= 1;
        if (depth === 0) return { inner: text.slice(start + 1, i), end: i + 1 };
      }
    }
    return null;
  }

  /** "one {# word} other {# words}" -> { one: '# word', other: '# words' } */
  function forms(text) {
    const result = {};
    let i = 0;
    while (i < text.length) {
      const label = /^\s*(=\d+|zero|one|two|few|many|other)\s*/.exec(text.slice(i));
      if (!label) break;
      const found = block(text, i + label[0].length);
      if (!found) break;
      result[label[1]] = found.inner;
      i = found.end;
    }
    return result;
  }

  function pick(value, options, lang) {
    const count = Number(value);
    if (options[`=${count}`] !== undefined) return options[`=${count}`];
    if (!plurals.has(lang)) plurals.set(lang, new Intl.PluralRules(lang));
    const category = Number.isFinite(count) ? plurals.get(lang).select(count) : 'other';
    return options[category] ?? options.other ?? '';
  }

  /**
   * Fills a message in.
   * @param {string} message
   * @param {Record<string, unknown>} [values]
   * @param {string} [lang]  For numbers and plural rules.
   */
  function format(message, values = {}, lang = state.lang) {
    let out = '';
    let i = 0;
    while (i < message.length) {
      const open = message.indexOf('{', i);
      if (open === -1) {
        out += message.slice(i);
        break;
      }
      out += message.slice(i, open);
      const found = block(message, open);
      if (!found) {
        out += message.slice(open);
        break;
      }
      const plural = /^\s*(\w+)\s*,\s*plural\s*,([\s\S]*)$/.exec(found.inner);
      const simple = /^\s*(\w+)\s*$/.exec(found.inner);
      if (plural) {
        const value = values?.[plural[1]];
        const chosen = pick(value, forms(plural[2]), lang);
        out += format(chosen.replace(/#/g, shown(Number(value), lang)), values, lang);
      } else if (simple && values && Object.prototype.hasOwnProperty.call(values, simple[1])) {
        out += shown(values[simple[1]], lang);
      } else {
        out += message.slice(open, found.end); // not ours: left as it is
      }
      i = found.end;
    }
    return out;
  }

  /**
   * The interface text for a key. A key no file has comes back as itself (and is reported on
   * the console in a development build), so a mistake shows instead of an empty space.
   * @param {string} key
   * @param {Record<string, unknown>} [values]  Values for the message's {placeholders}.
   */
  function t(key, values) {
    if (!state.loaded) {
      // Too early: the key stands in until the strings arrive, and whoever drew it is told then
      // (onChange). In a frame inside a page this is what starts the loading.
      state.early = true;
      load();
    }
    const message = state.messages[key];
    if (typeof message !== 'string') {
      if (DEV && state.loaded && !warned.has(key)) {
        warned.add(key);
        console.warn(`Wordvault i18n: no message "${key}" in ${state.lang} or ${SOURCE}`);
      }
      return key;
    }
    return values || message.includes('{') ? format(message, values, state.lang) : message;
  }

  // --- Loading -----------------------------------------------------------------------------------

  const version = () => {
    try {
      return chrome.runtime.getManifest().version;
    } catch {
      return '';
    }
  };

  /** Whether this context can read the extension's own files (its pages and background script can, content scripts cannot). */
  function ownOrigin() {
    try {
      return String(globalThis.location?.href || '').startsWith(chrome.runtime.getURL(''));
    } catch {
      return false;
    }
  }

  /** Reads a language file. Tests replace it (setReader). */
  let reader = async (lang) => {
    const response = await fetch(chrome.runtime.getURL(`locales/${lang}.json`));
    if (!response.ok) throw new Error(`locales/${lang}.json: ${response.status}`);
    return response.json();
  };

  /** The messages of a language with English where it has none. Only that language and English are read. */
  async function readMerged(lang) {
    const source = await reader(SOURCE);
    if (lang === SOURCE) return source;
    let own = {};
    try {
      own = await reader(lang);
    } catch (error) {
      if (DEV) console.warn(`Wordvault i18n: cannot read ${lang}`, error);
    }
    return { ...source, ...own };
  }

  /**
   * Builds the stored entry for the chosen language and keeps it. Pages and the background
   * script call this; content scripts ask the background script (wv:i18n:load).
   * @param {{ force?: boolean }} [options]  force: rebuild even if the entry looks current.
   * @returns {Promise<{ lang: string, version: string, messages: Record<string, string> }>}
   */
  async function publish({ force = false } = {}) {
    const stored = await chrome.storage.local.get([CHOICE_KEY, CACHE_KEY]);
    const lang = resolve(stored[CHOICE_KEY], browserLanguage());
    const cache = stored[CACHE_KEY];
    if (!force && cache?.lang === lang && cache?.version === version() && cache.messages) return cache;
    const entry = { lang, version: version(), messages: await readMerged(lang) };
    await chrome.storage.local.set({ [CACHE_KEY]: entry });
    return entry;
  }

  function use(entry) {
    if (!entry?.messages) return false;
    // (the same language stored again, as the background script does when it starts, is no
    // change; the first strings are one for whoever drew something before they were there)
    const changed = state.loaded ? entry.lang !== state.lang || entry.version !== state.version : state.early;
    state.lang = entry.lang;
    state.version = entry.version;
    state.messages = entry.messages;
    state.loaded = true;
    if (changed) for (const listener of [...listeners]) {
      try {
        listener(state.lang);
      } catch (error) {
        console.error(error);
      }
    }
    return true;
  }

  /** Loads the chosen language once; later calls return the same promise. */
  let loading = null;
  function load() {
    loading ||= (async () => {
      try {
        const stored = await chrome.storage.local.get([CHOICE_KEY, CACHE_KEY]);
        const lang = resolve(stored[CHOICE_KEY], browserLanguage());
        const cache = stored[CACHE_KEY];
        if (cache?.lang === lang && cache?.version === version() && use(cache)) return state.lang;
        if (ownOrigin()) use(await publish());
        else use(await chrome.runtime.sendMessage({ type: 'wv:i18n:load' }).then((reply) => reply?.result));
      } catch (error) {
        if (DEV) console.warn('Wordvault i18n: strings not loaded', error);
      }
      state.loaded = true;
      state.early = false;
      return state.lang;
    })();
    return loading;
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[CACHE_KEY]?.newValue) use(changes[CACHE_KEY].newValue);
    });
  } catch {
    // no storage here (a test that does not need it)
  }

  /**
   * Chooses the interface language ('' = follow the browser) and makes every open part of
   * Wordvault switch to it.
   */
  async function setLanguage(choice) {
    const value = choice && supported(choice) ? choice : '';
    const lang = resolve(value, browserLanguage());
    const entry = { lang, version: version(), messages: await readMerged(lang) };
    await chrome.storage.local.set({ [CHOICE_KEY]: value, [CACHE_KEY]: entry });
    use(entry);
    return lang;
  }

  /**
   * For the extension's own pages: waits for the strings, puts the language and the writing
   * direction on the document, and keeps them in step. A page that builds its content once
   * (popup, settings) is reloaded when the language changes; one that redraws itself passes
   * reload: false and listens with onChange.
   */
  async function startPage({ reload = true } = {}) {
    await load();
    const apply = () => {
      document.documentElement.lang = state.lang;
      document.documentElement.dir = WV.i18n.dir();
    };
    apply();
    WV.i18n.onChange(() => (reload ? location.reload() : apply()));
  }

  async function getChoice() {
    const stored = await chrome.storage.local.get(CHOICE_KEY);
    return typeof stored[CHOICE_KEY] === 'string' ? stored[CHOICE_KEY] : '';
  }

  WV.i18n = {
    LANGUAGES,
    SOURCE,
    CHOICE_KEY,
    CACHE_KEY,
    t,
    format,
    resolve,
    load,
    publish,
    setLanguage,
    getChoice,
    startPage,
    browserLanguage,
    /** The language in use, as a BCP 47 tag for Intl ("tr", "pt-BR"). */
    lang: () => state.lang,
    dir: (lang = state.lang) => (RTL.has(String(lang).split('-')[0]) ? 'rtl' : 'ltr'),
    number: (value) => number(value),
    /** Called with the new language whenever it changes (in any context). Returns a function that stops it. */
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** For tests: where language files are read from, and a fresh start. */
    setReader(read) {
      reader = read;
    },
    reset() {
      Object.assign(state, { lang: SOURCE, version: '', messages: {}, loaded: false, early: false });
      loading = null;
      listeners.clear();
      warned.clear();
    },
  };
  WV.t = t;

  // A content script in a page's top frame loads the strings right away: its interface (the
  // translation popup) is drawn the moment the user asks. In the frames inside a page (often
  // many, mostly ads) they are loaded only once something there needs a text.
  try {
    if (globalThis.document && globalThis.top === globalThis.self && !ownOrigin() && chrome.storage) load();
  } catch {
    // a frame of another origin above this one: not the top frame
  }
})(globalThis.WV);
