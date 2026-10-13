'use strict';

// The translation popup: a small card anchored to a piece of text: what the user selected, or
// the word a word source (core/hover/word-source.js) found under the pointer.
//
// It has two modes. For a word: the word, its translation and alternatives, and the vault. For
// a passage (a selected sentence or paragraph; `mode: 'passage'`): the text, shortened, its
// translation with the line breaks it had, a copy button, and keeping it as a phrase.

(function (WV) {
  if (!WV.supported || WV.popup) return;
  const { h, t, icon, languages, speech } = WV;

  /** Minimum distance between the card and the viewport edge. */
  const MARGIN = 8;
  /** Distance between the selection and the card. */
  const GAP = 6;
  /** Translations longer than this are sentences rather than words and get body-text styling. */
  const LONG_TRANSLATION_CHARS = 60;
  /** A passage up to this long can be kept in the vault as a phrase (the vault's limit for a text). */
  const PHRASE_MAX_CHARS = 500;
  /**
   * ASSUMPTION: a passage up to this long can be read aloud (about a minute). A reading cannot
   * be stopped once it has begun (shared/speech.js says why), so there is none for more.
   */
  const SPEAK_MAX_CHARS = 1000;

  const ICON_CLOSE = 'M6 6l12 12M18 6L6 18';
  const ICON_BACK = 'M15 6l-6 6 6 6';
  const ICON_COPY = 'M9 9h10v11H9zM5 15V4h10';
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
    // a service that needs the user's own key (providers/deepl.js); $1 is its name, $2 a language
    auth: 'errAuth',
    quota: 'errQuota',
    no_key: 'errNoKey',
    provider_permission: 'errProviderPermission',
    provider_language: 'errProviderLanguage',
    passage_too_long: 'errPassageTooLong',
  };
  const RETRYABLE = new Set(['network', 'timeout', 'provider_error', 'internal']);
  /** Failures of the translation itself: the word can still be saved, just without one. */
  const SAVEABLE_ERRORS = new Set(['network', 'timeout', 'rate_limit', 'unsupported_language', 'provider_error', 'no_result', 'internal', 'auth', 'quota', 'no_key', 'provider_permission', 'provider_language']);
  /** How long "Added to vault" stays on screen. */
  const STATUS_MS = 2200;

  /** The per-site source language is keyed by host name, so it only exists for web pages. */
  const canPinSite = /^https?:$/.test(location.protocol);

  let ui = null; // DOM, built on first use
  let session = null; // the lookup on screen; null while the popup is closed
  // Language preferences from the background script: { languages, targetLang, targetChosen }.
  // Fetched again every time the popup opens, so there is no second copy to go stale.
  let prefs = null;
  let frame = 0; // pending requestAnimationFrame for repositioning
  let statusTimer = 0;

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
    // Passage mode: the selected text is shown shortened; this shows all of it (and less again).
    const more = h('button', { class: 'wv-link wv-more', type: 'button', hidden: true, onclick: toggleSource });
    const body = h('div', { class: 'wv-body', 'aria-live': 'polite' });
    const actions = h('div', { class: 'wv-actions' });
    const foot = h('div', { class: 'wv-foot' });
    const main = h(
      'div',
      { class: 'wv-main' },
      h('div', { class: 'wv-head' }, word, speakButton, iconButton(ICON_CLOSE, 'popupClose', close)),
      more,
      h('div', { class: 'wv-langs' }, source.button, h('span', { class: 'wv-arrow', 'aria-hidden': 'true', text: '→' }), target.button),
      pinRow,
      setup,
      body,
      actions,
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
      more,
      speakButton,
      sourceLabel: source.label,
      targetLabel: target.label,
      pinRow,
      pinBox,
      setup,
      setupText,
      body,
      actions,
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
      if (session === current) {
        current.result = null;
        current.error = { code: 'internal', ...error };
        showError(error);
        renderActions();
      }
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

  /** The button is only offered when the word can be pronounced in its language. */
  function updateSpeakButton() {
    if (!ui || !session) return;
    ui.speakButton.hidden = !(session.mode === 'passage' ? canReadPassage() : speech.available(session.sourceLang));
  }

  /**
   * A passage is read by the browser's own voice: there are recordings of words, not of
   * sentences. Where recordings stand in for that voice (shared/speech.js: usesRecordings) it
   * is only used if the user has allowed it there.
   */
  function canReadPassage() {
    const { text, sourceLang } = session;
    if (!sourceLang || text.length > SPEAK_MAX_CHARS || !speech.canSpeak(sourceLang)) return false;
    return !speech.usesRecordings || speech.options.ttsFallback === true;
  }

  async function speak() {
    const current = session;
    if (!current?.sourceLang || current.speaking) return;
    if (current.mode === 'passage') {
      if (canReadPassage()) speech.speak(current.text, current.sourceLang);
      return;
    }
    current.speaking = true;
    ui.speakButton.classList.add('wv-busy');
    const outcome = await speech.pronounce(current.text, current.sourceLang).catch(() => ({ via: null }));
    current.speaking = false;
    if (session !== current) return;
    ui.speakButton.classList.remove('wv-busy');
    if (!outcome.via) flashStatus({ text: t('speakNoRecording'), muted: true });
    if (outcome.credit) {
      current.credit = outcome.credit;
      renderFoot();
    }
  }

  // --- Body states -----------------------------------------------------------------------------

  /** Replaces the body content; falsy entries are skipped so callers can use `condition && node`. */
  function setBody(...children) {
    ui.body.replaceChildren(...children.filter(Boolean));
  }

  function linkButton(labelKey, onclick) {
    return h('button', { class: 'wv-link', type: 'button', text: t(labelKey), onclick });
  }

  /** Attribution: the translation service, and the recording if one was played. */
  function renderFoot() {
    const { result, credit } = session;
    ui.foot.replaceChildren(
      ...[
        result?.translation && h('span', { text: t('popupTranslatedBy', [result.provider.name]) }),
        credit &&
          h('a', { href: credit.page, target: '_blank', rel: 'noopener noreferrer', title: credit.title, text: t('speakCredit') }),
      ].filter(Boolean),
    );
  }

  function showLoading() {
    setBody(h('div', { class: 'wv-loading' }, h('span', { class: 'wv-spinner' }), t('popupTranslating')));
    renderFoot();
  }

  /** The note under a result that turned out to be in the language translations are made into. */
  function sameLanguageNote(data) {
    return h(
      'div',
      { class: 'wv-note' },
      t('noteSameLanguage', [languages.name(data.targetLang)]),
      ' ',
      linkButton('linkChangeSource', () => openSheet('source')),
      ' · ',
      linkButton('linkChangeTarget', () => openSheet('target')),
    );
  }

  /** What an error is called, in the user's language. */
  function errorText(error) {
    const code = error?.code || 'internal';
    if (code === 'passage_too_long') return t('errPassageTooLong', [Number(error.detail).toLocaleString(), Number(error.context?.length || 0).toLocaleString()]);
    const service = error?.context?.provider?.name || session?.result?.provider?.name || '';
    return t(ERROR_MESSAGES[code] || 'errUnknown', [service, code === 'provider_language' ? languages.name(error.detail) : '']);
  }

  /** A passage: its translation with the line breaks of the selection; a part of it, with what went wrong, if that is all there is. */
  function showPassage(data) {
    setBody(
      data.translation && h('div', { class: 'wv-translation wv-long wv-passage-text', dir: 'auto', lang: data.targetLang, tabindex: '0', text: data.translation }),
      data.partial && h('div', { class: 'wv-error wv-partial', role: 'alert', text: t('passagePartial', [String(data.partial.done), String(data.pieces), errorText({ ...data.partial, context: { provider: data.provider } })]) }),
      data.sameLanguage && sameLanguageNote(data),
    );
    renderFoot();
  }

  /** A passage on its way: what is translated so far, and how far that is. */
  function showProgress({ done, total, translation }) {
    setBody(
      h('div', { class: 'wv-translation wv-long wv-passage-text', dir: 'auto', lang: prefs?.targetLang || null, text: translation }),
      h('div', { class: 'wv-loading' }, h('span', { class: 'wv-spinner' }), t('passageProgress', [String(done), String(total)])),
    );
  }

  function showResult(data) {
    if (!data.translation && !data.sameLanguage) {
      showError({ code: 'no_result' });
      return;
    }
    if (session.mode === 'passage') {
      showPassage(data);
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
      // The service lost letters on its side ("e?itle"): said, not hidden; saving still works.
      data.damaged && h('div', { class: 'wv-note', text: t('noteDamaged', [data.provider.name]) }),
      // Informational only: it never replaces the result above.
      data.sameLanguage && sameLanguageNote(data),
    );
    renderFoot();
  }

  function showError(error) {
    const code = error?.code || 'internal';
    const known = ERROR_MESSAGES[code];
    const service = error?.context?.provider?.name || '';
    const fallback = error?.context?.fallback;
    setBody(
      h('div', { class: 'wv-error', role: 'alert', text: errorText(error) }),
      // For errors we have no message for, the provider's own wording is better than nothing.
      !known && error?.detail && h('div', { class: 'wv-error-detail', text: error.detail }),
      // Not the default service: said by name, and nothing is switched unless the user asks.
      fallback && h('div', { class: 'wv-note', text: t('noteProviderFailed', [service, fallback.name]) }),
    );
    renderFoot();
  }

  // --- Vault -----------------------------------------------------------------------------------

  /**
   * The row under the result: "Try again" after a failure and the vault button. The vault button
   * is there whenever there is something to save, with or without a translation.
   * @param {{ text: string, error?: boolean, muted?: boolean }} [status] Short message shown next to it.
   */
  function renderActions(status) {
    const { result, error, saved, saving } = session;
    const passage = session.mode === 'passage';
    const children = [];
    // (A passage of which a part is missing can be asked for again: what there is is remembered.)
    if ((error && RETRYABLE.has(error.code)) || result?.partial) {
      children.push(h('button', { class: 'wv-btn', type: 'button', text: t('popupRetry'), onclick: () => lookup({ fresh: true }) }));
    }
    // The chosen service failed: the default one is offered for this lookup. The setting stays.
    const fallback = error?.context?.fallback;
    if (fallback) {
      children.push(
        h('button', {
          class: 'wv-btn',
          type: 'button',
          'data-action': 'fallback',
          text: t('popupContinueWith', [fallback.name]),
          onclick: () => {
            session.provider = fallback.id;
            lookup();
          },
        }),
      );
    }
    if (passage && result?.translation) {
      children.push(h('button', { class: 'wv-btn', type: 'button', 'data-action': 'copy', onclick: copyTranslation }, icon(ICON_COPY), ' ', t('passageCopy')));
    }
    // A passage is never put into the vault by itself; short enough, it can be kept as a phrase.
    if (passage && result?.translation && !result.partial && session.text.length <= PHRASE_MAX_CHARS) {
      children.push(
        h('button', {
          class: saved ? 'wv-btn wv-btn-saved' : 'wv-btn',
          type: 'button',
          'data-action': 'phrase',
          disabled: saving,
          title: saved ? t('vaultRemoveHint') : t('vaultAddPhraseHint'),
          'aria-pressed': String(saved),
          text: saved ? t('vaultSaved') : t('vaultAddPhrase'),
          onclick: toggleSaved,
        }),
      );
    }
    if (!passage && (result || (error && SAVEABLE_ERRORS.has(error.code)))) {
      const translated = Boolean(result?.translation);
      children.push(
        h('button', {
          class: saved ? 'wv-btn wv-btn-saved' : translated ? 'wv-btn wv-btn-primary' : 'wv-btn',
          type: 'button',
          disabled: saving,
          title: saved ? t('vaultRemoveHint') : null,
          'aria-pressed': String(saved),
          text: saved ? t('vaultSaved') : t(translated ? 'vaultAdd' : 'vaultAddUntranslated'),
          onclick: toggleSaved,
        }),
      );
    }
    if (status) {
      const kind = status.error ? ' wv-status-error' : status.muted ? ' wv-status-muted' : '';
      children.push(h('span', { class: `wv-status${kind}`, role: 'status', text: status.text }));
    }
    ui.actions.replaceChildren(...children);
  }

  /** Shows a short message in the actions row and takes it away again. */
  function flashStatus(status) {
    const current = session;
    renderActions(status);
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      if (session === current) renderActions();
    }, STATUS_MS);
  }

  /** Adds the word to the vault, or takes it out again if it is already there. */
  async function toggleSaved() {
    const current = session;
    if (current.saving) return;
    const known = current.result || current.error?.context || {};
    const identity = {
      text: known.text || current.text,
      sourceLang: current.sourceLang,
      targetLang: known.targetLang || prefs?.targetLang || '',
    };
    const wasSaved = current.saved;
    current.saving = true;
    renderActions();
    let status;
    try {
      if (wasSaved) {
        await WV.send('wv:vault:remove', identity);
      } else {
        await WV.send('wv:vault:add', {
          ...identity,
          translation: current.result?.translation || '',
          alternatives: current.result?.alternatives || [],
          sentence: current.sentence,
          // (the window that stands in for a page has no page of its own to name)
          url: current.standalone ? '' : location.href,
          title: current.standalone ? '' : document.title,
          ...(current.mode === 'passage' ? { kind: 'phrase' } : {}),
        });
      }
      current.saved = !wasSaved;
      status = { text: t(wasSaved ? 'vaultRemoved' : 'vaultAdded') };
    } catch {
      status = { text: t('vaultError'), error: true };
    }
    current.saving = false;
    if (session === current) flashStatus(status);
  }

  /**
   * Puts the translation on the clipboard. Pages that are not served securely have no
   * clipboard API; there the old way is used, on a field of our own that is gone at once, and
   * the page's selection is put back.
   */
  async function copyTranslation() {
    const current = session;
    const text = current.result?.translation || '';
    let copied = false;
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch {
      const field = h('textarea', { class: 'wv-offscreen', 'aria-hidden': 'true', tabindex: '-1' });
      field.value = text;
      ui.card.append(field);
      const selection = window.getSelection();
      const kept = selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
      try {
        field.select();
        copied = document.execCommand('copy');
      } catch {
        copied = false;
      }
      field.remove();
      if (kept) {
        selection.removeAllRanges();
        selection.addRange(kept);
      }
    }
    if (session === current) flashStatus(copied ? { text: t('passageCopied') } : { text: t('passageCopyFailed'), error: true });
  }

  /** "Show all" / "Show less" for the selected text of a passage. */
  function toggleSource() {
    const expanded = ui.word.classList.toggle('wv-expanded');
    ui.more.textContent = t(expanded ? 'passageShowLess' : 'passageShowAll');
    position();
  }

  /** The link is only there when the text does not fit in the lines it is given. */
  function updateMore() {
    if (session?.mode !== 'passage') {
      ui.more.hidden = true;
      return;
    }
    const expanded = ui.word.classList.contains('wv-expanded');
    ui.more.hidden = !expanded && ui.word.scrollHeight <= ui.word.clientHeight + 1;
    ui.more.textContent = t(expanded ? 'passageShowLess' : 'passageShowAll');
  }

  /** Translates the session's text, with the source language the user fixed (if any). */
  /** @param {{ fresh?: boolean }} [options]  fresh: "Try again": ask even if this just failed. */
  async function lookup({ fresh = false } = {}) {
    const current = session;
    // The answer to what was asked before is not wanted any more: that request is given up.
    current.controller?.abort();
    const controller = (current.controller = new AbortController());
    const requestId = ++current.requestId;
    const isStale = () => session !== current || current.requestId !== requestId;
    current.result = null;
    current.error = null;
    current.credit = null;
    clearTimeout(statusTimer);
    showLoading();
    ui.actions.replaceChildren();
    renderLanguages();
    try {
      const data = await WV.translateClient.translate({
        text: current.text,
        sample: current.sample,
        pageLang: current.pageLang,
        source: current.source,
        provider: current.provider || undefined,
        fresh,
        passage: current.mode === 'passage' || undefined,
      }, {
        signal: controller.signal,
        onProgress: (progress) => {
          if (!isStale()) showProgress(progress);
        },
      });
      if (isStale()) return;
      current.result = data;
      current.sourceLang = data.sourceLang;
      current.sourceMode = data.sourceMode;
      current.saved = data.saved;
      if (data.sourceMode === 'site') current.sitePinned = true;
      if (prefs) prefs.targetLang = data.targetLang;
      showResult(data);
    } catch (error) {
      if (isStale() || error?.code === 'aborted') return;
      current.error = { code: 'internal', ...error };
      current.sourceLang = current.source || error?.context?.sourceLang || '';
      current.saved = Boolean(error?.context?.saved);
      showError(error);
    }
    renderActions();
    renderLanguages();
    updateSpeakButton();
    position();
  }

  // --- Positioning -----------------------------------------------------------------------------

  /** Where the selection currently is, in viewport coordinates; null if it no longer exists. */
  function anchorRect() {
    if (session.pinned) return session.pinned;
    if (session.range.startContainer.isConnected) {
      const rect = session.range.getBoundingClientRect();
      if (rect.width > 0 || rect.height > 0) return rect;
    }
    // The text is gone or hidden. Text that is expected to change under the popup (a caption)
    // came with the place it was at, and the popup stays there.
    return session.lastRect;
  }

  function position() {
    if (!session) return;
    if (session.standalone) return; // it fills its window (see the styles)
    const rect = anchorRect();
    const viewportWidth = Math.min(window.innerWidth, document.documentElement.clientWidth || Infinity);
    const viewportHeight = window.innerHeight;
    const offScreen = !rect || rect.bottom < 0 || rect.top > viewportHeight || rect.right < 0 || rect.left > viewportWidth;
    if (offScreen) {
      close();
      return;
    }
    const { offsetWidth: width, offsetHeight: height } = ui.card;
    // Sideways the card lines up with the word; up and down it keeps clear of the whole block
    // the word is part of (the other rows of a caption), when the request named one.
    const block = session.avoid || rect;
    const edgeTop = Math.min(rect.top, block.top);
    const edgeBottom = Math.max(rect.bottom, block.bottom);
    const fitsBelow = height <= viewportHeight - edgeBottom - GAP - MARGIN;
    const fitsAbove = height <= edgeTop - GAP - MARGIN;
    // Stay on the side chosen when the popup opened; only switch when the card has outgrown
    // that side and fits on the other, so it does not jump around as its content changes.
    if (session.below === null) session.below = session.avoid ? !fitsAbove && fitsBelow : fitsBelow || viewportHeight - edgeBottom >= edgeTop;
    else if (session.below && !fitsBelow && fitsAbove) session.below = false;
    else if (!session.below && !fitsAbove && fitsBelow) session.below = true;
    const top = session.below ? edgeBottom + GAP : edgeTop - GAP - height;
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
    if (!session.standalone && !ui.surface.containsEvent(event)) close();
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
    if (session.standalone || ui.surface.containsEvent(event)) return; // scrolling inside the card (the language list)
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
   * @param {DOMRect} [request.rect]    Where the text is right now, for text that may be redrawn
   *                                    or removed while the popup is open: the popup then stays
   *                                    at this place instead of closing.
   * @param {DOMRect} [request.avoid]   The block the text is part of, which the popup should
   *                                    not cover; it then goes above it when there is room.
   * @param {'word' | 'passage'} [request.mode]  'passage': a selected sentence or paragraph.
   * @param {boolean} [request.standalone]  The popup is all there is in its window (the window
   *                                    that stands in on pages nothing can be drawn on):
   *                                    it fills it, and closing it closes the window.
   */
  function open({ text, range, point, sentence = '', sample = '', pageLang = '', rect: lastRect = null, avoid = null, mode = 'word', standalone = false }) {
    ui ||= build();
    if (!session) {
      for (const [type, listener, options] of LISTENERS) window.addEventListener(type, listener, options);
    }
    // Opened for another word while the last one was still being asked for.
    session?.controller?.abort();
    // Selections inside shadow trees and replaced elements can report an empty rectangle.
    const rect = range?.getBoundingClientRect();
    const pinned = rect && (rect.width > 0 || rect.height > 0) ? null : lastRect || new DOMRect(point?.x || 0, point?.y || 0, 0, 0);
    session = {
      mode: mode === 'passage' ? 'passage' : 'word',
      standalone: standalone === true,
      text,
      range,
      pinned,
      lastRect,
      avoid,
      sentence,
      sample,
      pageLang,
      source: null, // language picked by the user in this popup
      provider: null, // "continue with …": the service used for this lookup instead of the chosen one
      sourceLang: '', // language the text is (believed to be) in
      sourceMode: 'auto', // 'auto', 'manual' or 'site' (pinned for this host)
      sitePinned: false,
      result: null,
      error: null, // set instead of `result` when the lookup failed
      saved: false, // whether the word is in the vault
      saving: false,
      speaking: false, // a pronunciation is being fetched
      credit: null, // recording that was played, for attribution
      sheet: null, // 'source' or 'target' while the language sheet is open
      below: null, // which side of the selection the card is on
      requestId: 0,
      controller: null, // gives up the lookup that is under way
      prefsReady: null,
    };

    ui.word.textContent = text;
    ui.word.classList.remove('wv-expanded');
    ui.card.classList.toggle('wv-passage', session.mode === 'passage');
    ui.card.classList.toggle('wv-standalone', session.standalone);
    ui.speakButton.hidden = true;
    ui.speakButton.classList.remove('wv-busy');
    ui.actions.replaceChildren();
    ui.sheet.hidden = true;
    ui.main.hidden = false;
    ui.surface.mount(range?.commonAncestorContainer);
    updateMore();
    session.prefsReady = loadPrefs();
    lookup();
    position();
  }

  function close() {
    if (!session) return;
    session.controller?.abort();
    const { standalone } = session;
    session = null;
    for (const [type, listener, options] of LISTENERS) window.removeEventListener(type, listener, options);
    cancelAnimationFrame(frame);
    clearTimeout(statusTimer);
    frame = 0;
    ui.surface.unmount();
    if (standalone) window.close();
  }

  /**
   * Opens the popup for a word found by a word source. This is all the popup needs to know
   * about hovering: the hit carries the word, its line and where it is.
   * @param {Object} hit  A WordHit (core/hover/word-source.js).
   */
  function openForHit(hit) {
    const { rect, area } = hit;
    open({
      text: hit.text,
      range: hit.range,
      rect: new DOMRect(rect.left, rect.top, rect.width, rect.height),
      avoid: area ? new DOMRect(area.left, area.top, area.width, area.height) : null,
      point: { x: rect.left, y: rect.bottom },
      // The line is the word's context in the vault and what its language is told from.
      sentence: hit.line,
      sample: hit.line,
      pageLang: hit.lang,
    });
  }

  WV.popup = {
    open,
    openForHit,
    close,
    isOpen: () => Boolean(session),
    /** Whether a passage (rather than a word) is on screen. */
    showsPassage: () => session?.mode === 'passage',
    containsEvent: (event) => Boolean(ui) && ui.surface.containsEvent(event),
    /** Settings changed somewhere (options page, another tab): show the current values. */
    settingsChanged: () => {
      if (session) session.prefsReady = loadPrefs();
    },
  };
})(globalThis.WV);
