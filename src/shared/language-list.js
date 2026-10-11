'use strict';

// Language names and the searchable language list used wherever a language can be picked.

(function (WV) {
  if (WV.languages) return;
  const { h, t } = WV;

  let uiNames = null;
  const nativeNames = new Map();

  function uiLanguage() {
    try {
      return chrome.i18n.getUILanguage();
    } catch {
      return 'en';
    }
  }

  function displayName(code, locale, formatter) {
    try {
      const value = formatter.of(code);
      if (value && value !== code) return value.charAt(0).toLocaleUpperCase(locale) + value.slice(1);
    } catch {
      // Unknown code: the caller falls back to the code itself.
    }
    return '';
  }

  /** "en" -> "English" / "İngilizce", in the browser's UI language. */
  function name(code) {
    if (!code) return '';
    try {
      uiNames ||= new Intl.DisplayNames([uiLanguage()], { type: 'language' });
    } catch {
      return code;
    }
    return displayName(code, uiLanguage(), uiNames) || code;
  }

  /** "de" -> "Deutsch": the language's name in the language itself ('' if unknown). */
  function nativeName(code) {
    if (!nativeNames.has(code)) {
      let value = '';
      try {
        value = displayName(code, code, new Intl.DisplayNames([code], { type: 'language' }));
      } catch {
        // No locale data for this language.
      }
      nativeNames.set(code, value);
    }
    return nativeNames.get(code);
  }

  /** Case- and accent-insensitive form used for matching what the user types. */
  function fold(value) {
    return value
      .toLocaleLowerCase(uiLanguage())
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .replace(/ı/g, 'i')
      .trim();
  }

  /**
   * A search box above a list of languages. Typing filters by the language's name in the UI
   * language, its native name or its code; arrow keys and Enter work from the search box.
   *
   * @param {{ onSelect: (code: string) => void }} options `code` is '' for the automatic entry.
   */
  function createList({ onSelect }) {
    const search = h('input', {
      class: 'wv-ll-search',
      type: 'text',
      placeholder: t('langSearch'),
      'aria-label': t('langSearch'),
      autocomplete: 'off',
      autocapitalize: 'off',
      spellcheck: 'false',
    });
    const list = h('div', { class: 'wv-ll-list', role: 'listbox' });
    const empty = h('div', { class: 'wv-ll-empty', text: t('langNoMatch'), hidden: true });
    const element = h('div', { class: 'wv-ll' }, search, list, empty);

    let items = []; // { code, button, haystack }
    let active = null;

    const visible = () => items.filter((item) => !item.button.hidden);

    function setActive(item) {
      active?.button.classList.remove('wv-ll-active');
      active = item || null;
      if (!active) return;
      active.button.classList.add('wv-ll-active');
      // Not scrollIntoView(): that could also scroll the page the list is shown on.
      const { offsetTop, offsetHeight } = active.button;
      if (offsetTop < list.scrollTop) list.scrollTop = offsetTop;
      else if (offsetTop + offsetHeight > list.scrollTop + list.clientHeight) {
        list.scrollTop = offsetTop + offsetHeight - list.clientHeight;
      }
    }

    function filter() {
      const query = fold(search.value);
      for (const item of items) item.button.hidden = Boolean(query) && !item.haystack.includes(query);
      const shown = visible();
      empty.hidden = shown.length > 0;
      setActive(query ? shown[0] : null);
    }

    function move(step) {
      const shown = visible();
      if (shown.length === 0) return;
      const index = shown.indexOf(active);
      setActive(shown[Math.max(0, Math.min(shown.length - 1, index + step))]);
    }

    search.addEventListener('input', filter);
    search.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        move(event.key === 'ArrowDown' ? 1 : -1);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const choice = active || visible()[0];
        if (choice) onSelect(choice.code);
      }
    });

    /**
     * @param {Object} options
     * @param {string[]} options.codes      Language codes to offer.
     * @param {string} options.value        Currently selected code ('' for the automatic entry).
     * @param {string} [options.autoLabel]  If given, an extra first entry with code ''.
     */
    function setOptions({ codes, value, autoLabel }) {
      const collator = new Intl.Collator(uiLanguage());
      const entries = codes
        .map((code) => ({ code, label: name(code), native: nativeName(code) }))
        .sort((a, b) => collator.compare(a.label, b.label));
      if (autoLabel) entries.unshift({ code: '', label: autoLabel, native: '' });

      items = entries.map(({ code, label, native }) => {
        const showNative = native && fold(native) !== fold(label);
        const button = h(
          'button',
          {
            // The automatic entry stays in view while the list scrolls to the selected language.
            class: code ? 'wv-ll-item' : 'wv-ll-item wv-ll-pinned',
            type: 'button',
            role: 'option',
            'aria-selected': String(code === value),
            onclick: () => onSelect(code),
          },
          h('span', { text: label }),
          showNative && h('span', { class: 'wv-ll-native', lang: code, text: native }),
        );
        return { code, button, haystack: fold(`${label} ${native} ${code}`) };
      });
      list.replaceChildren(...items.map((item) => item.button));
      search.value = '';
      empty.hidden = items.length > 0;
      active = null;

      const selected = items.find((item) => item.code === value);
      if (selected) list.scrollTop = Math.max(0, selected.button.offsetTop - list.clientHeight / 2);
    }

    return {
      element,
      setOptions,
      focus: () => search.focus({ preventScroll: true }),
    };
  }

  WV.languages = { name, nativeName, uiLanguage, createList };
})(globalThis.WV);
