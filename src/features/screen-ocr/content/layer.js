'use strict';

// The text layer: what was read from the picture, laid exactly over the place it was read
// from, the way a scanned PDF carries its text. The text itself is invisible (the page under
// it shows the real thing) but it can be pointed at and selected.

(function (WV) {
  if (!WV.supported || WV.ocrLayer) return;
  const { h, t, icon } = WV;

  const ICON_CLOSE = 'M6 6l12 12M18 6L6 18';

  const CSS = `
    .wv-ocr-layer { position: fixed; top: 0; left: 0; width: 0; height: 0; }
    .wv-ocr-frame {
      position: absolute; pointer-events: none;
      border: 1.5px solid var(--wv-accent); border-radius: 3px;
      box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.7);
    }
    .wv-ocr-word {
      position: absolute; margin: 0; padding: 0; overflow: hidden; white-space: pre;
      color: transparent; cursor: text; line-height: 1; transform-origin: 0 0;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
      border-radius: 2px; user-select: text; -webkit-user-select: text;
    }
    .wv-ocr-word { cursor: pointer; }
    .wv-ocr-word:hover, .wv-ocr-word.wv-active { background: rgba(255, 204, 0, 0.45); }
    .wv-ocr-word::selection { background: rgba(79, 70, 229, 0.35); color: transparent; }
    /* Troubleshooting ("show OCR boxes" in the settings): where every word was found. */
    .wv-ocr-boxes .wv-ocr-word { outline: 1px solid rgba(255, 60, 60, 0.9); }
    .wv-ocr-tools {
      position: absolute; display: flex; align-items: center; gap: 6px; padding: 3px 4px 3px 10px;
      background: var(--wv-bg); color: var(--wv-fg); border: 1px solid var(--wv-border);
      border-radius: 999px; box-shadow: var(--wv-shadow); white-space: nowrap;
    }
    .wv-ocr-status { display: flex; align-items: center; gap: 8px; }
    .wv-ocr-error { color: var(--wv-danger); }
  `;

  /** Distance between the scanned area and the little bar with its status and close button. */
  const GAP = 6;
  const BAR_HEIGHT = 34;

  let ui = null;
  let current = null; // { area, scrollX, scrollY } while the layer is on screen

  function build() {
    const surface = WV.createSurface(CSS);
    const frame = h('div', { class: 'wv-ocr-frame' });
    const words = h('div', { class: 'wv-ocr-words' });
    const status = h('span', { class: 'wv-ocr-status', role: 'status' });
    const close = h('button', { class: 'wv-btn-icon', type: 'button', title: t('ocrClose'), 'aria-label': t('ocrClose'), onclick: () => hide() }, icon(ICON_CLOSE));
    const tools = h('div', { class: 'wv-ocr-tools' }, status, close);
    const layer = h('div', { class: 'wv-ocr-layer' }, frame, words, tools);
    surface.root.append(layer);
    return { surface, layer, frame, words, status, tools, close };
  }

  // The interface language changed. A result on screen keeps its status line (it says what
  // happened, in the language of that moment); the button is relabelled, and the next layer is
  // built in the new language.
  WV.i18n.onChange(() => {
    if (!ui) return;
    if (!current) {
      ui = null;
      return;
    }
    ui.close.title = t('ocrClose');
    ui.close.setAttribute('aria-label', t('ocrClose'));
  });

  function place(element, rect) {
    Object.assign(element.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  }

  /** The bar sits above the area's right corner, or below it, or inside when neither fits. */
  function placeTools(area) {
    const above = area.y - GAP - BAR_HEIGHT >= GAP;
    const below = area.y + area.height + GAP + BAR_HEIGHT <= window.innerHeight - GAP;
    const top = above ? area.y - GAP - BAR_HEIGHT : below ? area.y + area.height + GAP : area.y + GAP;
    ui.tools.style.top = `${top}px`;
    ui.tools.style.right = 'auto';
    const width = ui.tools.offsetWidth;
    const left = Math.max(GAP, Math.min(area.x + area.width - width, window.innerWidth - width - GAP));
    ui.tools.style.left = `${left}px`;
  }

  // The layer belongs to a place on the page, so it moves with the page when that scrolls.
  function onScroll() {
    if (!current) return;
    ui.layer.style.transform = `translate(${current.scrollX - window.scrollX}px, ${current.scrollY - window.scrollY}px)`;
  }

  function onKeyDown(event) {
    if (event.key !== 'Escape' || event.isComposing) return;
    if (WV.popup?.isOpen()) return; // the bubble is on top; Escape is for it first
    event.preventDefault();
    event.stopImmediatePropagation();
    hide();
  }

  function open(area) {
    ui ||= build();
    if (!current) {
      window.addEventListener('keydown', onKeyDown, true);
      window.addEventListener('scroll', onScroll, { passive: true });
    }
    current = { area, scrollX: window.scrollX, scrollY: window.scrollY, onClose: current?.onClose || null };
    ui.layer.style.transform = '';
    place(ui.frame, area);
    ui.surface.mount();
  }

  /**
   * Shows that the area is being read.
   * @param {{ x: number, y: number, width: number, height: number }} area  CSS px of the viewport.
   * @param {string} text  What is going on, localized.
   */
  function showBusy(area, text) {
    if (!current || current.area !== area) {
      open(area);
      ui.words.replaceChildren();
      ui.layer.classList.remove('wv-ocr-boxes');
    }
    ui.status.className = 'wv-ocr-status';
    ui.status.replaceChildren(h('span', { class: 'wv-spinner' }), text);
    placeTools(area);
  }

  /**
   * Shows what was read.
   * @param {Object} result  As returned by the background script: area, words (with `rect` in
   *                         CSS px of the viewport), info.
   * @param {Object} [options]
   * @param {boolean} [options.showBoxes]  Draw the box of every word (troubleshooting).
   * @param {(word: Object, element: Element) => void} [options.onWord]  A word was clicked.
   */
  function showResult(result, { showBoxes = false, onWord = () => {} } = {}) {
    open(result.area);
    ui.layer.classList.toggle('wv-ocr-boxes', showBoxes);
    const nodes = result.words.map((word) => {
      const node = h('span', {
        class: 'wv-ocr-word',
        'data-word': String(word.id),
        dir: 'auto',
        text: word.text,
        onclick: (event) => {
          // A click that ends a drag has selected text; that is not a lookup of one word.
          if (!event.isTrusted || String(ui.surface.root.getRootNode().getSelection?.() || '').trim().length > word.text.length) return;
          onWord(word, node);
        },
      });
      place(node, word.rect);
      // Glyphs are about as tall as the box; the width is then stretched to match exactly.
      node.style.fontSize = `${Math.max(4, word.rect.height * 0.9)}px`;
      node.style.lineHeight = `${word.rect.height}px`;
      return node;
    });
    ui.words.replaceChildren(...nodes);
    // The text is laid out in whatever font is at hand; stretched sideways it covers its box,
    // so that a selection drawn over the picture starts and ends where the words do.
    for (const [index, node] of nodes.entries()) {
      const natural = node.scrollWidth;
      const wanted = result.words[index].rect.width;
      if (natural > 0 && wanted > 0) {
        node.style.width = `${natural}px`;
        node.style.transform = `scaleX(${wanted / natural})`;
      }
    }
    ui.status.className = 'wv-ocr-status';
    ui.status.textContent = t('ocrResult', { count: result.words.length });
    placeTools(result.area);
  }

  /** @param {string} message  Localized. */
  function showError(area, message) {
    open(area);
    ui.words.replaceChildren();
    ui.status.className = 'wv-ocr-status wv-ocr-error';
    ui.status.textContent = message;
    placeTools(area);
  }

  function hide() {
    if (!current) return;
    const { onClose } = current;
    current = null;
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('scroll', onScroll);
    ui.words.replaceChildren();
    ui.surface.unmount();
    onClose?.();
  }

  /** Marks the word the bubble is open for (null: none). */
  function setActive(element) {
    for (const node of ui?.words.children || []) node.classList.toggle('wv-active', node === element);
  }

  /** Where a set of words is on screen right now (the layer moves with the page). */
  function rectOf(wordIds) {
    const rects = [...(ui?.words.children || [])].filter((node) => wordIds.includes(Number(node.dataset.word))).map((node) => node.getBoundingClientRect());
    if (rects.length === 0) return null;
    const left = Math.min(...rects.map((rect) => rect.left));
    const top = Math.min(...rects.map((rect) => rect.top));
    return new DOMRect(left, top, Math.max(...rects.map((rect) => rect.right)) - left, Math.max(...rects.map((rect) => rect.bottom)) - top);
  }

  /** The word of the layer at a point of the screen, or null. */
  function wordIdAt(x, y) {
    for (const node of ui?.words.children || []) {
      const rect = node.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return Number(node.dataset.word);
    }
    return null;
  }

  WV.ocrLayer = {
    setActive,
    rectOf,
    wordIdAt,
    showBusy,
    showResult,
    showError,
    hide,
    isOpen: () => Boolean(current),
    /** Called once when the layer that is on screen goes away. */
    onClose(listener) {
      if (current) current.onClose = listener;
    },
  };
})(globalThis.WV);
