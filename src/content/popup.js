'use strict';

// The translation popup: a small card anchored to the selected text.

(function (WV) {
  if (!WV.supported || WV.popup) return;
  const { h, t, icon, languages, speech } = WV;

  /** Minimum distance between the card and the viewport edge. */
  const MARGIN = 8;
  /** Distance between the selection and the card. */
  const GAP = 6;
  /** Translations longer than this are sentences rather than words and get body-text styling. */
  const LONG_TRANSLATION_CHARS = 60;

  const ICON_CLOSE = 'M6 6l12 12M18 6L6 18';
  const ICON_BACK = 'M15 6l-6 6 6 6';
  const ICON_SPEAKER = 'M11 5L6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13';

  const ERROR_MESSAGES = {
    network: 'errNetwork',
    timeout: 'errTimeout',
    rate_limit: 'errRateLimit',
    unsupported_language: 'errUnsupportedLanguage',
    too_long: 'errTooLong',
    no_result: 'errNoResult',
    empty: 'errNoResult',
    context_invalidated: 'errContextInvalidated',
  };
  const RETRYABLE = new Set(['network', 'timeout', 'provider_error', 'internal']);

  /** The per-site source language is keyed by host name, so it only exists for web pages. */
  const canPinSite = /^https?:$/.test(location.protocol);

  let ui = null; // DOM, built on first use
  let session = null; // the lookup on screen; null while the popup is closed
  // Language preferences from the background script: { languages, targetLang, targetChosen }.
  // Fetched again every time the popup opens, so there is no second copy to go stale.
  let prefs = null;
  let frame = 0; // pending requestAnimationFrame for repositioning

  const clamp = (value, min, max) => Math.max(min, Math.min(value, max));

  function iconButton(path, labelKey, onclick) {
    return h('button', { class: 'wv-btn-icon', type: 'button', title: t(labelKey), 'aria-label': t(labelKey), onclick }, icon(path));
  }

  /** A language name that opens the language sheet when clicked. */
  function chip(labelKey, onclick) {
    const label = h('span', { class: 'wv-chip-label' });
    const button = h('button', { class: 'wv-chip', type: 'button', title: t(labelKey), onclick }, label);
    return { button, label };
  }

  function build() {
    const surface = WV.createSurface(WV.styles.popup);

    // Main view: the word, the language pair and the result.
    const word = h('div', { class: 'wv-word', dir: 'auto' });
    const speakButton = iconButton(ICON_SPEAKER, 'popupSpeak', speak);
    speakButton.hidden = true;
    const source = chip('popupSourceLang', () => openSheet('source'));
    const target = chip('popupTargetLang', () => openSheet('target'));
    const pinBox = h('input', { type: 'checkbox', onchange: () => pinSite(pinBox.checked) });
    const pinRow = h('label', { class: 'wv-check', hidden: true }, pinBox, h('span', { text: t('sitePin') }));
    // Shown until the user has picked (or confirmed) the language they want translations in.
    const setupText = h('div');
    const setup = h(
      'div',
      { class: 'wv-setup', hidden: true },
      setupText,
      h(
        'div',
        { class: 'wv-setup-actions' },
        h('button', { class: 'wv-btn wv-btn-sm wv-btn-primary', type: 'button', text: t('firstRunConfirm'), onclick: () => chooseTarget(prefs.targetLang) }),
        h('button', { class: 'wv-btn wv-btn-sm', type: 'button', text: t('firstRunChange'), onclick: () => openSheet('target') }),
      ),
    );
    const body = h('div', { class: 'wv-body', 'aria-live': 'polite' });
    const foot = h('div', { class: 'wv-foot' });
    const main = h(
      'div',
      { class: 'wv-main' },
      h('div', { class: 'wv-head' }, word, speakButton, iconButton(ICON_CLOSE, 'popupClose', close)),
      h('div', { class: 'wv-langs' }, source.button, h('span', { class: 'wv-arrow', 'aria-hidden': 'true', text: '→' }), target.button),
      pinRow,
      setup,
      body,
      foot,
    );

    // Language sheet: replaces the main view while the user picks a language.
    const sheetTitle = h('div', { class: 'wv-sheet-title' });
    const picker = languages.createList({ onSelect: pickLanguage });
    const sheet = h(
      'div',
      { class: 'wv-sheet', hidden: true },
      h('div', { class: 'wv-head' }, iconButton(ICON_BACK, 'popupBack', closeSheet), sheetTitle, iconButton(ICON_CLOSE, 'popupClose', close)),
      picker.element,
    );

    const card = h('div', { class: 'wv-card', role: 'dialog', 'aria-label': 'Wordvault' }, main, sheet);
    surface.root.append(card);

    // Keep the card inside the viewport whenever its size changes (result arrived, sheet opened).
    new ResizeObserver(position).observe(card);
    speech.onVoicesChanged(updateSpeakButton);

    return {
      surface,
      card,
      main,
      word,
      speakButton,
      sourceLabel: source.label,
      targetLabel: target.label,
      pinRow,
      pinBox,
      setup,
      setupText,
      body,
      foot,
      sheet,
      sheetTitle,
      picker,
    };
  }

  // --- Languages -------------------------------------------------------------------------------

  /** Source language the user fixed, by picking it in this popup or by pinning it to the site. */
  function fixedSource() {
    return session.source || (session.sourceMode === 'site' ? session.sourceLang : '');
  }

  function renderLanguages() {
    const { source, sourceLang, sourceMode } = session;
    let sourceText = t('langAuto');
    if (source) sourceText = languages.name(source);
    else if (sourceLang) sourceText = sourceMode === 'auto' ? t('langAutoDetected', [languages.name(sourceLang)]) : languages.name(sourceLang);
    ui.sourceLabel.textContent = sourceText;
    ui.targetLabel.textContent = languages.name(prefs?.targetLang || session.result?.targetLang || '') || '…';

    ui.pinRow.hidden = !(canPinSite && fixedSource());
    ui.pinBox.checked = session.sitePinned;

    const needsSetup = Boolean(prefs) && !prefs.targetChosen;
    ui.setup.hidden = !needsSetup;
    if (needsSetup) ui.setupText.textContent = t('firstRunText', [languages.name(prefs.targetLang)]);
  }

  async function loadPrefs() {
    const current = session;
    try {
      const next = await WV.send('wv:prefs');
      if (session !== current) return;
      prefs = next;
      renderLanguages();
    } catch {
      // Without the list the language sheets cannot open; translating still works.
    }
  }

  async function openSheet(kind) {
    const current = session;
    await current.prefsReady;
    if (session !== current || !prefs) return;
    current.sheet = kind;
    ui.sheetTitle.textContent = t(kind === 'source' ? 'popupSourceLang' : 'popupTargetLang');
    ui.main.hidden = true;
    ui.sheet.hidden = false;
    ui.picker.setOptions(
      kind === 'source'
        ? { codes: prefs.languages, value: fixedSource(), autoLabel: t('langAuto') }
        : { codes: prefs.languages, value: prefs.targetLang },
    );
    position();
    ui.picker.focus();
  }

  function closeSheet() {
    if (!session?.sheet) return;
    session.sheet = null;
    ui.sheet.hidden = true;
    ui.main.hidden = false;
    position();
  }

  function pickLanguage(code) {
    const kind = session.sheet;
    closeSheet();
    if (kind === 'target') chooseTarget(code);
    else chooseSource(code);
  }

  /** @param {string} code Language picked by the user; '' goes back to automatic detection. */
  async function chooseSource(code) {
    const current = session;
    current.source = code || null;
    current.sourceLang = code;
    current.sourceMode = code ? 'manual' : 'auto';
    showLoading();
    renderLanguages();
    if (current.sitePinned) {
      // "Always on this site" is ticked: the pin follows the new choice, or goes away with it.
      // Stored before translating again, because the lookup reads the pin.
      current.sitePinned = Boolean(code);
      await WV.send('wv:setSiteSource', { lang: code || null }).catch(() => {});
      if (session !== current) return;
    }
    lookup();
  }

  /** Stores the target language (for every part of the extension) and translates again. */
  async function chooseTarget(code) {
    const current = session;
    const changed = code !== prefs.targetLang;
    if (changed) showLoading();
    try {
      const saved = await WV.send('wv:setTargetLang', { code });
      prefs = { ...prefs, targetLang: saved, targetChosen: true };
    } catch (error) {
      if (session === current) showError(error);
      return;
    }
    if (session !== current) return;
    renderLanguages();
    if (changed) lookup();
  }

  async function pinSite(pinned) {
    const lang = fixedSource();
    // From here on the language is the user's explicit choice for this popup either way.
    session.source = lang;
    session.sourceMode = 'manual';
    session.sitePinned = pinned;
    try {
      await WV.send('wv:setSiteSource', { lang: pinned ? lang : null });
    } catch {
      if (session) session.sitePinned = !pinned;
    }
    if (session) renderLanguages();
  }

  // --- Pronunciation ---------------------------------------------------------------------------

  /** The button is only offered when the browser has a voice for the source language. */
  function updateSpeakButton() {
    if (!ui || !session) return;
    ui.speakButton.hidden = !speech.canSpeak(session.sourceLang);
  }

  function speak() {
    if (session?.sourceLang) speech.speak(session.text, session.sourceLang);
  }

  // --- Body states -----------------------------------------------------------------------------

  /** Replaces the body content; falsy entries are skipped so callers can use `condition && node`. */
  function setBody(...children) {
    ui.body.replaceChildren(...children.filter(Boolean));
  }

  function linkButton(labelKey, onclick) {
    return h('button', { class: 'wv-link', type: 'button', text: t(labelKey), onclick });
  }

  function showLoading() {
    setBody(h('div', { class: 'wv-loading' }, h('span', { class: 'wv-spinner' }), t('popupTranslating')));
    ui.foot.textContent = '';
  }

  function showResult(data) {
    if (!data.translation && !data.sameLanguage) {
      showError({ code: 'no_result' });
      return;
    }
    const long = data.translation.length > LONG_TRANSLATION_CHARS;
    setBody(
      data.translation &&
        h('div', { class: long ? 'wv-translation wv-long' : 'wv-translation', dir: 'auto', lang: data.targetLang, text: data.translation }),
      data.alternatives.length > 0 &&
        h(
          'div',
          { class: 'wv-alts' },
          h('span', { class: 'wv-alts-label', text: t('popupAlternatives') }),
          ' ',
          h('span', { dir: 'auto', lang: data.targetLang, text: data.alternatives.join(', ') }),
        ),
      // Informational only: it never replaces the result above.
      data.sameLanguage &&
        h(
          'div',
          { class: 'wv-note' },
          t('noteSameLanguage', [languages.name(data.targetLang)]),
          ' ',
          linkButton('linkChangeSource', () => openSheet('source')),
          ' · ',
          linkButton('linkChangeTarget', () => openSheet('target')),
        ),
    );
    ui.foot.textContent = data.translation ? t('popupTranslatedBy', [data.provider.name]) : '';
  }

  function showError(error) {
    const code = error?.code || 'internal';
    const known = ERROR_MESSAGES[code];
    setBody(
      h('div', { class: 'wv-error', role: 'alert', text: t(known || 'errUnknown') }),
      // For errors we have no message for, the provider's own wording is better than nothing.
      !known && error?.detail && h('div', { class: 'wv-error-detail', text: error.detail }),
      RETRYABLE.has(code) && h('div', { class: 'wv-actions' }, h('button', { class: 'wv-btn', type: 'button', text: t('popupRetry'), onclick: lookup })),
    );
    ui.foot.textContent = '';
  }

  /** Translates the session's text, with the source language the user fixed (if any). */
  async function lookup() {
    const current = session;
    const requestId = ++current.requestId;
    const isStale = () => session !== current || current.requestId !== requestId;
    current.result = null;
    showLoading();
    renderLanguages();
    try {
      const data = await WV.send('wv:translate', {
        text: current.text,
        sample: current.sample,
        pageLang: current.pageLang,
        source: current.source,
      });
      if (isStale()) return;
      current.result = data;
      current.sourceLang = data.sourceLang;
      current.sourceMode = data.sourceMode;
      if (data.sourceMode === 'site') current.sitePinned = true;
      if (prefs) prefs.targetLang = data.targetLang;
      showResult(data);
    } catch (error) {
      if (isStale()) return;
      current.sourceLang = current.source || error?.context?.sourceLang || '';
      showError(error);
    }
    renderLanguages();
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
    const fitsBelow = height <= viewportHeight - rect.bottom - GAP - MARGIN;
    const fitsAbove = height <= rect.top - GAP - MARGIN;
    // Stay on the side chosen when the popup opened; only switch when the card has outgrown
    // that side and fits on the other, so it does not jump around as its content changes.
    if (session.below === null) session.below = fitsBelow || viewportHeight - rect.bottom >= rect.top;
    else if (session.below && !fitsBelow && fitsAbove) session.below = false;
    else if (!session.below && !fitsAbove && fitsBelow) session.below = true;
    const top = session.below ? rect.bottom + GAP : rect.top - GAP - height;
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
    // The popup is the topmost layer, so Escape closes it (or its language sheet first) and
    // nothing underneath it, such as a page dialog the text was selected in.
    event.preventDefault();
    event.stopImmediatePropagation();
    window.addEventListener('keyup', swallowEscape, { capture: true, once: true });
    if (session.sheet) closeSheet();
    else close();
  }

  function onScroll(event) {
    if (ui.surface.containsEvent(event)) return; // scrolling inside the card (the language list)
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
    session = {
      text,
      range,
      pinned,
      sentence,
      sample,
      pageLang,
      source: null, // language picked by the user in this popup
      sourceLang: '', // language the text is (believed to be) in
      sourceMode: 'auto', // 'auto', 'manual' or 'site' (pinned for this host)
      sitePinned: false,
      result: null,
      sheet: null, // 'source' or 'target' while the language sheet is open
      below: null, // which side of the selection the card is on
      requestId: 0,
      prefsReady: null,
    };

    ui.word.textContent = text;
    ui.speakButton.hidden = true;
    ui.sheet.hidden = true;
    ui.main.hidden = false;
    ui.surface.mount(range?.commonAncestorContainer);
    session.prefsReady = loadPrefs();
    lookup();
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
    isOpen: () => Boolean(session),
    containsEvent: (event) => Boolean(ui) && ui.surface.containsEvent(event),
    /** Settings changed somewhere (options page, another tab): show the current values. */
    settingsChanged: () => {
      if (session) session.prefsReady = loadPrefs();
    },
  };
})(globalThis.WV);
