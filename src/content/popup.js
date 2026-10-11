'use strict';

// The translation popup: a small card anchored to the selected text.

(function (WV) {
  if (!WV.supported || WV.popup) return;
  const { h, t, icon } = WV;

  /** Minimum distance between the card and the viewport edge. */
  const MARGIN = 8;
  /** Distance between the selection and the card. */
  const GAP = 6;
  /** Translations longer than this are sentences rather than words and get body-text styling. */
  const LONG_TRANSLATION_CHARS = 60;

  const ICON_CLOSE = 'M6 6l12 12M18 6L6 18';
  const ICON_SPEAKER = 'M11 5L6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13';

  const ERROR_MESSAGES = {
    network: 'errNetwork',
    timeout: 'errTimeout',
    rate_limit: 'errRateLimit',
    unsupported_language: 'errUnsupportedLanguage',
    same_language: 'errSameLanguage',
    too_long: 'errTooLong',
    no_result: 'errNoResult',
    empty: 'errNoResult',
    context_invalidated: 'errContextInvalidated',
  };
  const RETRYABLE = new Set(['network', 'timeout', 'provider_error', 'internal']);

  let ui = null; // DOM, built on first use
  let session = null; // the lookup on screen; null while the popup is closed
  let frame = 0; // pending requestAnimationFrame for repositioning
  let languagesLoaded = false;
  let targetLang = ''; // last known target language, shown while a lookup is still running
  let displayNames = null;

  const clamp = (value, min, max) => Math.max(min, Math.min(value, max));

  function uiLanguage() {
    try {
      return chrome.i18n.getUILanguage();
    } catch {
      return 'en';
    }
  }

  /** "en" -> "English" / "İngilizce", in the browser's UI language. */
  function languageName(code) {
    if (!code) return '';
    try {
      displayNames ||= new Intl.DisplayNames([uiLanguage()], { type: 'language' });
      const name = displayNames.of(code);
      if (name && name !== code) return name.charAt(0).toLocaleUpperCase(uiLanguage()) + name.slice(1);
    } catch {
      // Unknown code: show it as is.
    }
    return code;
  }

  function build() {
    const surface = WV.createSurface(WV.styles.popup);
    const word = h('div', { class: 'wv-word', dir: 'auto' });
    const speakButton = h(
      'button',
      { class: 'wv-btn-icon', type: 'button', title: t('popupSpeak'), 'aria-label': t('popupSpeak'), hidden: true, onclick: speak },
      icon(ICON_SPEAKER),
    );
    const closeButton = h(
      'button',
      { class: 'wv-btn-icon', type: 'button', title: t('popupClose'), 'aria-label': t('popupClose'), onclick: close },
      icon(ICON_CLOSE),
    );
    // The detected language doubles as a control: detection from a single word is a guess, so
    // the user can correct it and the lookup is repeated with the chosen language. A native
    // <select> is as wide as its longest option, so it sits invisibly on top of a text label
    // that shows the current choice.
    const sourceLabel = h('span', { class: 'wv-lang-label' });
    const sourceSelect = h(
      'select',
      {
        class: 'wv-lang',
        title: t('popupSourceLang'),
        'aria-label': t('popupSourceLang'),
        onchange: () => {
          syncSourceLabel();
          lookup(sourceSelect.value || null);
        },
      },
      h('option', { value: '', text: t('langAuto') }),
    );
    const targetLabel = h('span', { class: 'wv-target' });
    const body = h('div', { class: 'wv-body', 'aria-live': 'polite' });
    const foot = h('div', { class: 'wv-foot' });
    const card = h(
      'div',
      { class: 'wv-card', role: 'dialog', 'aria-label': 'Wordvault' },
      h('div', { class: 'wv-head' }, word, speakButton, closeButton),
      h(
        'div',
        { class: 'wv-langs' },
        h('span', { class: 'wv-lang-wrap' }, sourceLabel, sourceSelect),
        h('span', { class: 'wv-arrow', 'aria-hidden': 'true', text: '→' }),
        targetLabel,
      ),
      body,
      foot,
    );
    surface.root.append(card);

    // Keep the card inside the viewport whenever its size changes (result arrived, fonts loaded).
    new ResizeObserver(position).observe(card);
    // Voices load asynchronously in some browsers.
    window.speechSynthesis?.addEventListener?.('voiceschanged', updateSpeakButton);

    return { surface, card, word, speakButton, sourceLabel, sourceSelect, targetLabel, body, foot };
  }

  // --- Languages -------------------------------------------------------------------------------

  function syncSourceLabel() {
    ui.sourceLabel.textContent = ui.sourceSelect.selectedOptions[0]?.textContent || '';
  }

  function selectSource(code) {
    const select = ui.sourceSelect;
    if (code && ![...select.options].some((option) => option.value === code)) {
      select.append(h('option', { value: code, text: languageName(code) }));
    }
    select.value = code || '';
    syncSourceLabel();
  }

  /** Fills the source-language list once per page. */
  async function loadLanguages() {
    if (languagesLoaded) return;
    languagesLoaded = true;
    try {
      const info = await WV.send('wv:languages');
      const collator = new Intl.Collator(uiLanguage());
      const known = new Set([...ui.sourceSelect.options].map((option) => option.value));
      const selected = ui.sourceSelect.value;
      const entries = info.languages
        .filter((code) => !known.has(code))
        .map((code) => ({ code, name: languageName(code) }))
        .sort((a, b) => collator.compare(a.name, b.name));
      ui.sourceSelect.append(...entries.map(({ code, name }) => h('option', { value: code, text: name })));
      ui.sourceSelect.value = selected;
      targetLang ||= info.targetLang;
      if (!ui.targetLabel.textContent) ui.targetLabel.textContent = languageName(targetLang);
    } catch {
      languagesLoaded = false; // try again the next time the popup opens
    }
  }

  /** The provider or the target language may have changed: forget what was loaded. */
  function resetLanguages() {
    close();
    languagesLoaded = false;
    targetLang = '';
    if (ui) ui.sourceSelect.replaceChildren(h('option', { value: '', text: t('langAuto') }));
  }

  // --- Pronunciation ---------------------------------------------------------------------------

  function findVoice(lang) {
    const voices = window.speechSynthesis.getVoices();
    const wanted = lang.toLowerCase();
    const code = (voice) => voice.lang.replace('_', '-').toLowerCase();
    const voice =
      voices.find((candidate) => code(candidate) === wanted) ||
      voices.find((candidate) => code(candidate).split('-')[0] === wanted.split('-')[0]);
    return { listed: voices.length > 0, voice };
  }

  /** The button is only offered when the browser can actually speak the source language. */
  function updateSpeakButton() {
    if (!ui || !session) return;
    let available = false;
    if (session.sourceLang && window.speechSynthesis) {
      const { listed, voice } = findVoice(session.sourceLang);
      available = !listed || Boolean(voice); // an empty list means "not loaded yet"
    }
    ui.speakButton.hidden = !available;
  }

  function speak() {
    if (!session?.sourceLang || !window.speechSynthesis) return;
    const utterance = new SpeechSynthesisUtterance(session.text);
    utterance.lang = session.sourceLang;
    const { voice } = findVoice(session.sourceLang);
    if (voice) utterance.voice = voice;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }

  // --- Body states -----------------------------------------------------------------------------

  /** Replaces the body content; falsy entries are skipped so callers can use `condition && node`. */
  function setBody(...children) {
    ui.body.replaceChildren(...children.filter(Boolean));
  }

  function showLoading() {
    setBody(h('div', { class: 'wv-loading' }, h('span', { class: 'wv-spinner' }), t('popupTranslating')));
    ui.foot.textContent = '';
  }

  function showResult(data) {
    const long = data.translation.length > LONG_TRANSLATION_CHARS;
    setBody(
      h('div', { class: long ? 'wv-translation wv-long' : 'wv-translation', dir: 'auto', lang: data.targetLang, text: data.translation }),
      data.alternatives.length > 0 &&
        h(
          'div',
          { class: 'wv-alts' },
          h('span', { class: 'wv-alts-label', text: t('popupAlternatives') }),
          ' ',
          h('span', { dir: 'auto', lang: data.targetLang, text: data.alternatives.join(', ') }),
        ),
    );
    ui.foot.textContent = t('popupTranslatedBy', [data.provider.name]);
  }

  function showError(error) {
    const code = error?.code || 'internal';
    const known = ERROR_MESSAGES[code];
    setBody(
      h('div', { class: 'wv-error', role: 'alert', text: t(known || 'errUnknown') }),
      // For errors we have no message for, the provider's own wording is better than nothing.
      !known && error?.detail && h('div', { class: 'wv-error-detail', text: error.detail }),
      RETRYABLE.has(code) &&
        h('button', { class: 'wv-btn', type: 'button', text: t('popupRetry'), onclick: () => lookup(ui.sourceSelect.value || null) }),
    );
    ui.foot.textContent = '';
  }

  /** @param {string | null} source Language chosen by the user, or null to detect it. */
  async function lookup(source) {
    const current = session;
    const requestId = ++current.requestId;
    const isStale = () => session !== current || current.requestId !== requestId;
    showLoading();
    try {
      const data = await WV.send('wv:translate', {
        text: current.text,
        sample: current.sample,
        pageLang: current.pageLang,
        source,
      });
      if (isStale()) return;
      current.sourceLang = data.sourceLang;
      current.result = data;
      targetLang = data.targetLang;
      selectSource(data.sourceLang);
      ui.targetLabel.textContent = languageName(targetLang);
      showResult(data);
    } catch (error) {
      if (isStale()) return;
      current.sourceLang = source || '';
      current.result = null;
      showError(error);
    }
    updateSpeakButton();
    position();
  }

  // --- Positioning -----------------------------------------------------------------------------

  /** Where the selection currently is, in viewport coordinates; null if it no longer exists. */
  function anchorRect() {
    if (session.pinned) return session.pinned;
    if (!session.range.startContainer.isConnected) return null;
    const rect = session.range.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0 ? rect : null; // empty: the text was hidden
  }

  function position() {
    if (!session) return;
    const rect = anchorRect();
    const viewportWidth = Math.min(window.innerWidth, document.documentElement.clientWidth || Infinity);
    const viewportHeight = window.innerHeight;
    const offScreen = !rect || rect.bottom < 0 || rect.top > viewportHeight || rect.right < 0 || rect.left > viewportWidth;
    if (offScreen) {
      close();
      return;
    }
    const { offsetWidth: width, offsetHeight: height } = ui.card;
    const spaceBelow = viewportHeight - rect.bottom - GAP - MARGIN;
    const spaceAbove = rect.top - GAP - MARGIN;
    const placeBelow = height <= spaceBelow || spaceBelow >= spaceAbove;
    const top = placeBelow ? rect.bottom + GAP : rect.top - GAP - height;
    ui.card.style.left = `${Math.round(clamp(rect.left, MARGIN, viewportWidth - width - MARGIN))}px`;
    ui.card.style.top = `${Math.round(clamp(top, MARGIN, viewportHeight - height - MARGIN))}px`;
  }

  function schedulePosition() {
    if (!session || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      position();
    });
  }

  // --- Open / close ----------------------------------------------------------------------------

  function onPointerDown(event) {
    if (!ui.surface.containsEvent(event)) close();
  }

  function swallowEscape(event) {
    if (event.key === 'Escape') event.stopImmediatePropagation();
  }

  function onKeyDown(event) {
    if (event.key !== 'Escape' || event.isComposing) return;
    // The popup is the topmost layer, so Escape closes it and nothing underneath it (a page
    // dialog the text was selected in, for example).
    event.preventDefault();
    event.stopImmediatePropagation();
    window.addEventListener('keyup', swallowEscape, { capture: true, once: true });
    close();
  }

  function onScroll() {
    // A selection range follows the page; a bare point cannot, so that popup closes instead.
    if (session.pinned) close();
    else schedulePosition();
  }

  const LISTENERS = [
    ['pointerdown', onPointerDown, { capture: true }],
    ['keydown', onKeyDown, { capture: true }],
    ['scroll', onScroll, { capture: true, passive: true }],
    ['resize', schedulePosition, undefined],
  ];

  /**
   * Opens the popup for a piece of text (replacing the one on screen, if any).
   *
   * @param {Object} request
   * @param {string} request.text       Text to translate.
   * @param {Range | null} request.range        Where the text is; the popup follows it on scroll.
   * @param {{ x: number, y: number }} request.point  Fallback anchor (pointer position).
   * @param {string} [request.sentence] Sentence the text appears in.
   * @param {string} [request.sample]   Wider surrounding text, for language detection.
   * @param {string} [request.pageLang] `lang` attribute closest to the text.
   */
  function open({ text, range, point, sentence = '', sample = '', pageLang = '' }) {
    ui ||= build();
    if (!session) {
      for (const [type, listener, options] of LISTENERS) window.addEventListener(type, listener, options);
    }
    // Selections inside shadow trees and replaced elements can report an empty rectangle.
    const rect = range?.getBoundingClientRect();
    const pinned = rect && (rect.width > 0 || rect.height > 0) ? null : new DOMRect(point.x, point.y, 0, 0);
    session = { text, range, pinned, sentence, sample, pageLang, sourceLang: '', result: null, requestId: 0 };

    ui.word.textContent = text;
    ui.targetLabel.textContent = languageName(targetLang);
    selectSource('');
    ui.speakButton.hidden = true;
    ui.surface.mount(range?.commonAncestorContainer);
    loadLanguages();
    lookup(null);
    position();
  }

  function close() {
    if (!session) return;
    session = null;
    for (const [type, listener, options] of LISTENERS) window.removeEventListener(type, listener, options);
    cancelAnimationFrame(frame);
    frame = 0;
    ui.surface.unmount();
  }

  WV.popup = {
    open,
    close,
    resetLanguages,
    isOpen: () => Boolean(session),
    containsEvent: (event) => Boolean(ui) && ui.surface.containsEvent(event),
  };
})(globalThis.WV);
