'use strict';

// A translated passage shown where it was selected: the selected text of the page is replaced
// by its translation, and a small switch next to it goes back to the original and to the
// translation again with one click (the translation is kept; nothing is asked for again).
//
// As with "Translate this page with AI" (features/page-translate), the page's structure is never
// touched: only the text of text nodes that were already there changes (their `nodeValue`), and
// every change is recorded so that it can be put back. A paragraph that had links or emphasis
// inside it shows its translation as plain text in the first of its pieces while translated.

(function (WV) {
  if (!WV.supported || WV.inPlace) return;
  const { h, t, icon } = WV;

  /** Text inside these is never replaced. */
  const SKIP = 'textarea, input, select, option, script, style, noscript, template, code, pre, kbd, samp, svg, math, [contenteditable]:not([contenteditable="false"]), [role="textbox"], wordvault-ui';
  const ICON_CLOSE = 'M6 6l12 12M18 6L6 18';
  /** Distance between the switch and the text, and between the switch and the viewport edge. */
  const GAP = 6;
  const MARGIN = 6;

  const CSS = `
    .wv-ip {
      position: fixed; left: 0; top: 0; display: inline-flex; align-items: center; gap: 2px;
      padding: 2px; border: 1px solid var(--wv-border); border-radius: 999px;
      background: var(--wv-bg); color: var(--wv-fg); box-shadow: 0 2px 8px rgba(0, 0, 0, 0.16);
      font: 600 11px/1.2 system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; white-space: nowrap;
    }
    .wv-ip button {
      margin: 0; padding: 3px 8px; border: 0; border-radius: 999px; background: transparent;
      color: inherit; font: inherit; cursor: pointer;
    }
    .wv-ip button[aria-pressed="true"] { background: var(--wv-accent); color: #fff; }
    .wv-ip button.wv-ip-close { padding: 3px 4px; display: inline-flex; color: var(--wv-muted); }
    .wv-ip .wv-icon { width: 12px; height: 12px; }
  `;

  let enabled = true;
  const shown = new Set(); // replacements on this page
  let frame = 0;

  // --- Which text a selection covers -----------------------------------------------------------

  /** The nearest ancestor that starts a line of its own. */
  function blockOf(node) {
    for (let element = node.parentElement; element; element = element.parentElement) {
      let display = 'block';
      try {
        display = getComputedStyle(element).display;
      } catch {
        // stays 'block'
      }
      if (!display.startsWith('inline') && display !== 'contents') return element;
    }
    return null;
  }

  /**
   * The selected text of a range, by paragraph: the text nodes it covers, each with the part of
   * it that is selected. A paragraph ends where a block ends or at a line break (<br>), which is
   * also where the selection's text has a line break.
   * @returns {{ pieces: { node: Text, start: number, end: number }[], text: string }[]}
   */
  function paragraphsOf(range) {
    const root = range.commonAncestorContainer;
    const groups = [];
    let current = null;
    let breaks = 0;
    const visit = (node) => {
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.localName === 'br' && range.intersectsNode(node)) breaks += 1;
        return;
      }
      if (!range.intersectsNode(node) || node.parentElement?.closest(SKIP)) return;
      const start = node === range.startContainer ? range.startOffset : 0;
      const end = node === range.endContainer ? range.endOffset : node.data.length;
      if (end <= start || !node.data.slice(start, end).trim()) return;
      const block = blockOf(node);
      if (!current || current.block !== block || current.breaks !== breaks) {
        current = { block, breaks, pieces: [] };
        groups.push(current);
      }
      current.pieces.push({ node, start, end });
    };
    if (root.nodeType === Node.TEXT_NODE) visit(root);
    else {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) visit(node);
    }
    return groups.map((group) => ({
      pieces: group.pieces,
      text: group.pieces.map(({ node, start, end }) => node.data.slice(start, end)).join('').replace(/\s+/g, ' ').trim(),
    }));
  }

  /** The paragraphs of a translation, as the passage translation keeps them (one per line). */
  const linesOf = (translation) =>
    String(translation || '')
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);

  // --- One replacement -------------------------------------------------------------------------

  /**
   * Puts translations in place of paragraphs and keeps what is needed to go back and forth.
   * @param {{ pieces: object[] }[]} paragraphs  As paragraphsOf returns them.
   * @param {string[]} translations  One per paragraph.
   */
  function replace(paragraphs, translations) {
    /** @type {Map<Text, { original: string, translated: string }>} */
    const changed = new Map();
    paragraphs.forEach((paragraph, index) => {
      const translation = translations[index];
      if (!translation) return;
      paragraph.pieces.forEach(({ node, start, end }, position) => {
        const original = node.data;
        const selected = original.slice(start, end);
        // The white space around the selected part stays, so the text does not run into its neighbours.
        const lead = position === 0 ? /^\s*/.exec(selected)[0] : '';
        const trail = position === paragraph.pieces.length - 1 ? /\s*$/.exec(selected)[0] : '';
        const middle = position === 0 ? `${lead}${translation}${paragraph.pieces.length === 1 ? trail : ''}` : position === paragraph.pieces.length - 1 ? trail : '';
        const translated = original.slice(0, start) + middle + original.slice(end);
        changed.set(node, { original, translated });
        node.data = translated;
      });
    });
    return {
      changed,
      showOriginal() {
        for (const [node, { original, translated }] of changed) if (node.data === translated) node.data = original;
      },
      showTranslation() {
        for (const [node, { original, translated }] of changed) if (node.data === original) node.data = translated;
      },
      /** Whether any of the text is still on the page. */
      alive: () => [...changed.keys()].some((node) => node.isConnected),
      /** Where the replaced text is on screen. */
      rect() {
        const range = document.createRange();
        const rects = [];
        for (const node of changed.keys()) {
          if (!node.isConnected || !node.data.trim()) continue;
          range.selectNodeContents(node);
          rects.push(...[...range.getClientRects()].filter((rect) => rect.width > 0 || rect.height > 0));
        }
        if (rects.length === 0) return null;
        const left = Math.min(...rects.map((rect) => rect.left));
        const top = Math.min(...rects.map((rect) => rect.top));
        return new DOMRect(left, top, Math.max(...rects.map((rect) => rect.right)) - left, Math.max(...rects.map((rect) => rect.bottom)) - top);
      },
    };
  }

  // --- The switch next to it -------------------------------------------------------------------

  function createSwitch(item) {
    const surface = WV.createSurface(CSS);
    const original = h('button', { type: 'button', 'data-action': 'ip-original', 'aria-pressed': 'false', text: t('viewOriginal'), onclick: () => setTranslated(item, false) });
    const translated = h('button', { type: 'button', 'data-action': 'ip-translation', 'aria-pressed': 'true', text: t('viewTranslation'), onclick: () => setTranslated(item, true) });
    const close = h('button', { type: 'button', class: 'wv-ip-close', 'data-action': 'ip-close', title: t('ipClose'), 'aria-label': t('ipClose'), onclick: () => remove(item) }, icon(ICON_CLOSE));
    const bar = h('div', { class: 'wv-ip', role: 'group', 'aria-label': t('ipLabel') }, original, translated, close);
    // The press must not reach the page: it would take a selection away or follow a link.
    bar.addEventListener('pointerdown', (event) => event.stopPropagation());
    surface.root.append(bar);
    return { surface, bar, original, translated };
  }

  function setTranslated(item, value) {
    if (value) item.replacement.showTranslation();
    else item.replacement.showOriginal();
    item.translated = value;
    item.ui.original.setAttribute('aria-pressed', String(!value));
    item.ui.translated.setAttribute('aria-pressed', String(value));
    place(item);
  }

  function remove(item) {
    item.replacement.showOriginal();
    item.ui.surface.unmount();
    shown.delete(item);
  }

  /** Over the top right corner of the text, or under it when there is no room above. */
  function place(item) {
    if (!item.replacement.alive()) {
      item.ui.surface.unmount();
      shown.delete(item);
      return;
    }
    const rect = item.replacement.rect();
    const viewportWidth = Math.min(window.innerWidth, document.documentElement.clientWidth || Infinity);
    const visible = rect && rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < viewportWidth;
    item.ui.bar.hidden = !visible;
    if (!visible) return;
    const { offsetWidth: width, offsetHeight: height } = item.ui.bar;
    let top = rect.top - height - GAP;
    if (top < MARGIN) top = rect.bottom + GAP;
    const left = Math.max(MARGIN, Math.min(rect.right - width, viewportWidth - width - MARGIN));
    item.ui.bar.style.left = `${Math.round(left)}px`;
    item.ui.bar.style.top = `${Math.round(Math.min(top, window.innerHeight - height - MARGIN))}px`;
  }

  function follow() {
    if (frame || shown.size === 0) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      for (const item of [...shown]) place(item);
    });
  }
  window.addEventListener('scroll', follow, { capture: true, passive: true });
  window.addEventListener('resize', follow);

  // --- From outside ----------------------------------------------------------------------------

  /**
   * What a selection covers, taken before anything changes it. Call while the range is as the
   * user made it; the translation can come later.
   * @param {Range | null} range
   * @returns {{ paragraphs: object[] } | null}  Null where nothing can be replaced (a field, nothing selected).
   */
  function capture(range) {
    if (!enabled || !range || range.collapsed) return null;
    const paragraphs = paragraphsOf(range);
    return paragraphs.length > 0 ? { paragraphs } : null;
  }

  /**
   * Shows a translation in place of what was captured.
   * @param {{ paragraphs: object[] }} captured  From capture().
   * @param {Object} result  The passage translation (translation, targetLang, sourceLang).
   * @param {Object} [request]  Asked again paragraph by paragraph if the translation's lines do not
   *        match the paragraphs (the service joined or split some): { pageLang, source, provider }.
   * @returns {Promise<boolean>} Whether something was replaced.
   */
  async function show(captured, result, request = {}) {
    if (!enabled || !captured || !result?.translation || result.sameLanguage) return false;
    const { paragraphs } = captured;
    // Text that already shows one of our translations (the same passage asked again in another
    // language) is given back first.
    for (const item of [...shown]) {
      if (paragraphs.some((paragraph) => paragraph.pieces.some(({ node }) => item.replacement.changed.has(node)))) remove(item);
    }
    // The page changed the text since it was selected: it is not ours to replace any more.
    const intact = paragraphs.every((paragraph) => paragraph.pieces.every(({ node, end }) => node.isConnected && node.data.length >= end));
    if (!intact) return false;
    let translations = linesOf(result.translation);
    if (translations.length !== paragraphs.length) {
      if (paragraphs.length === 1) translations = [translations.join(' ')];
      else {
        const answers = await Promise.all(
          paragraphs.map((paragraph) =>
            WV.translateClient.translate({ text: paragraph.text, passage: true, pageLang: request.pageLang || '', source: request.source || '', provider: request.provider || undefined }).then(
              (data) => (data.sameLanguage ? paragraph.text : data.translation),
              () => '',
            ),
          ),
        );
        translations = answers.map((answer) => linesOf(answer).join(' '));
      }
    }
    if (!translations.some(Boolean)) return false;
    const item = { replacement: replace(paragraphs, translations), translated: true, ui: null };
    item.ui = createSwitch(item);
    shown.add(item);
    item.ui.surface.mount(paragraphs[0].pieces[0].node);
    place(item);
    return true;
  }

  // The interface language changed: the switches are labelled anew.
  WV.i18n.onChange(() => {
    for (const item of shown) {
      item.ui.original.textContent = t('viewOriginal');
      item.ui.translated.textContent = t('viewTranslation');
      item.ui.bar.setAttribute('aria-label', t('ipLabel'));
    }
  });

  WV.inPlace = {
    capture,
    show,
    /** The setting "Show the translation on the page". */
    setEnabled(value) {
      enabled = value !== false;
    },
    isEnabled: () => enabled,
    count: () => shown.size,
    /** Everything back to the original, switches gone. */
    restoreAll() {
      for (const item of [...shown]) remove(item);
    },
    paragraphsOf,
    linesOf,
  };
})(globalThis.WV);
