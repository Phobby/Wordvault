'use strict';

// The text layer: what was read from the picture, laid exactly over the place it was read
// from, the way a scanned PDF carries its text. The text itself is invisible (the page under
// it shows the real thing) but it can be pointed at and selected.
//
// Pointing at it:
//   click            the word (the translation bubble opens for it)
//   drag             the words from where the drag began to where it ends, in reading order,
//                    within one block (content/phrase.js); they are translated as a phrase
//   Shift+click      the phrase from the last word clicked to this one
//   double-click     the whole line of the word, as a phrase
//   Escape           drops the selection; a second Escape closes the layer
// The browser's own text selection is not used: it would follow the page's layout, not the
// reading order of the picture. The layer keeps the presses to itself, so a drag over a video
// neither pauses nor seeks it.
//
// "Translate" writes the translation of each block over the block, in the block's own colours,
// so that the part of the page reads in the other language; "Original" and "Translation" switch
// between the two without asking again.

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
      color: transparent; cursor: pointer; line-height: 1; transform-origin: 0 0;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
      border-radius: 2px; user-select: none; -webkit-user-select: none; touch-action: none;
    }
    .wv-ocr-words.wv-dragging .wv-ocr-word { cursor: text; }
    .wv-ocr-word:hover, .wv-ocr-word.wv-active { background: rgba(255, 204, 0, 0.45); }
    .wv-ocr-word.wv-selected { background: rgba(79, 70, 229, 0.35); }
    /* Troubleshooting ("show OCR boxes" in the settings): where every word was found. */
    .wv-ocr-boxes .wv-ocr-word { outline: 1px solid rgba(255, 60, 60, 0.9); }
    .wv-ocr-tools {
      position: absolute; display: flex; align-items: center; gap: 6px; padding: 3px 4px 3px 10px;
      background: var(--wv-bg); color: var(--wv-fg); border: 1px solid var(--wv-border);
      border-radius: 999px; box-shadow: var(--wv-shadow); white-space: nowrap;
    }
    .wv-ocr-status { display: flex; align-items: center; gap: 8px; }
    .wv-ocr-translations[hidden] { display: none; }
    .wv-ocr-tr {
      position: absolute; margin: 0; padding: 1px 3px; overflow: hidden; border-radius: 2px;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; line-height: 1.15;
      white-space: normal; overflow-wrap: anywhere; user-select: text; -webkit-user-select: text; cursor: text;
    }
    .wv-ocr-seg { display: inline-flex; padding: 2px; gap: 2px; border-radius: 999px; background: var(--wv-subtle, rgba(127, 127, 127, 0.15)); }
    .wv-ocr-seg button {
      margin: 0; padding: 3px 9px; border: 0; border-radius: 999px; background: transparent;
      color: inherit; font: inherit; font-weight: 600; cursor: pointer;
    }
    .wv-ocr-seg button[aria-pressed="true"] { background: var(--wv-accent); color: #fff; }
    .wv-ocr-error { color: var(--wv-danger); }
    .wv-ocr-actions { display: flex; align-items: center; gap: 4px; }
    .wv-ocr-actions[hidden], .wv-ocr-edit[hidden] { display: none; }
    .wv-ocr-edit { display: flex; align-items: center; gap: 4px; }
    .wv-ocr-edit input {
      width: min(420px, 60vw); font: inherit; padding: 3px 8px; border-radius: 999px;
      border: 1px solid var(--wv-border); background: var(--wv-bg); color: var(--wv-fg);
    }
  `;
  /** A press that moves less than this is a click, not a drag (CSS px). */
  const DRAG_DISTANCE = 4;
  /** How long a notice about the selection stays in the status line. */
  const NOTICE_MS = 3500;

  /** Distance between the scanned area and the little bar with its status and close button. */
  const GAP = 6;
  const BAR_HEIGHT = 34;

  let ui = null;
  let current = null; // { area, scrollX, scrollY } while the layer is on screen
  let shown = null; // the result on screen, with what the controller wants told
  let selected = { ids: [], anchor: null, edited: null }; // the phrase, and the word Shift+click extends from
  let press = null; // a press under way: { id, x, y, pointerId, dragging }
  let editing = null; // { resolve } while the phrase is being corrected
  let noticeTimer = 0;

  function build() {
    const surface = WV.createSurface(CSS);
    const frame = h('div', { class: 'wv-ocr-frame' });
    const words = h('div', { class: 'wv-ocr-words' });
    const status = h('span', { class: 'wv-ocr-status', role: 'status' });
    const close = h('button', { class: 'wv-btn-icon', type: 'button', title: t('ocrClose'), 'aria-label': t('ocrClose'), onclick: () => hide() }, icon(ICON_CLOSE));
    const action = (name, labelKey) => h('button', { class: 'wv-btn wv-btn-sm', type: 'button', 'data-ocr-action': name, text: t(labelKey), onclick: () => shown?.onAction(name) });
    const buttons = {
      explainAll: action('explainAll', 'ocrExplainAll'),
      explainSelection: action('explainSelection', 'ocrExplainSelection'),
      translateSelection: action('translateSelection', 'ocrTranslateSelection'),
      edit: action('edit', 'ocrEditSelection'),
    };
    const actions = h('div', { class: 'wv-ocr-actions', hidden: true }, ...Object.values(buttons));
    const editInput = h('input', { type: 'text', dir: 'auto', spellcheck: 'false', 'aria-label': t('ocrEditLabel'), onkeydown: onEditKey });
    const edit = h(
      'div',
      { class: 'wv-ocr-edit', hidden: true },
      editInput,
      h('button', { class: 'wv-btn wv-btn-sm wv-btn-primary', type: 'button', text: t('ocrEditDone'), onclick: () => finishEdit(true) }),
      h('button', { class: 'wv-btn wv-btn-sm', type: 'button', text: t('ocrCancel'), onclick: () => finishEdit(false) }),
    );
    const translations = h('div', { class: 'wv-ocr-translations', hidden: true });
    const translate = h('button', { class: 'wv-btn wv-btn-sm wv-btn-primary', type: 'button', 'data-action': 'ocr-translate', hidden: true, title: t('ocrTranslateHint'), text: t('ocrTranslate'), onclick: () => current?.onTranslate?.() });
    const original = h('button', { type: 'button', 'data-action': 'ocr-original', 'aria-pressed': 'false', text: t('viewOriginal'), onclick: () => setView(false) });
    const translated = h('button', { type: 'button', 'data-action': 'ocr-translation', 'aria-pressed': 'true', text: t('viewTranslation'), onclick: () => setView(true) });
    const views = h('div', { class: 'wv-ocr-seg', role: 'group', hidden: true }, original, translated);
    const tools = h('div', { class: 'wv-ocr-tools' }, actions, edit, status, translate, views, close);
    const layer = h('div', { class: 'wv-ocr-layer' }, frame, words, translations, tools);
    words.addEventListener('pointerdown', onPointerDown);
    words.addEventListener('pointermove', onPointerMove);
    words.addEventListener('pointerup', onPointerUp);
    words.addEventListener('pointercancel', cancelPress);
    words.addEventListener('dblclick', onDoubleClick);
    // Presses on the words are the layer's: the page under it (a video player) never hears of them.
    for (const type of ['click', 'mousedown', 'mouseup', 'contextmenu']) words.addEventListener(type, (event) => event.target.closest?.('.wv-ocr-word') && event.stopPropagation());
    surface.root.append(layer);
    return { surface, layer, frame, words, status, tools, close, actions, buttons, edit, editInput, translations, translate, views, original, translated };
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
    const labels = { explainAll: 'ocrExplainAll', explainSelection: 'ocrExplainSelection', translateSelection: 'ocrTranslateSelection', edit: 'ocrEditSelection' };
    for (const [name, key] of Object.entries(labels)) ui.buttons[name].textContent = t(key);
    ui.editInput.setAttribute('aria-label', t('ocrEditLabel'));
    ui.translate.textContent = t('ocrTranslate');
    ui.translate.title = t('ocrTranslateHint');
    ui.original.textContent = t('viewOriginal');
    ui.translated.textContent = t('viewTranslation');
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
    if (editing) return; // the field handles it
    if (WV.popup?.isOpen()) return; // the bubble is on top; Escape is for it first
    event.preventDefault();
    event.stopImmediatePropagation();
    // First the selection (or the drag under way), then the layer.
    if (press || selected.ids.length > 0) {
      cancelPress();
      select([]);
      return;
    }
    hide();
  }

  // --- Selecting words ---------------------------------------------------------------------------

  const wordNode = (event) => event.target.closest?.('.wv-ocr-word') || null;
  const idOf = (node) => Number(node.dataset.word);
  const wordById = (id) => shown?.result.words.find((word) => word.id === id) || null;
  const nodeById = (id) => ui?.words.querySelector(`[data-word="${id}"]`) || null;

  /** Marks the phrase on screen and tells the buttons whether there is one. */
  function select(ids, { anchor = selected.anchor } = {}) {
    selected = { ids: [...ids], anchor, edited: null };
    const set = new Set(ids);
    for (const node of ui?.words.children || []) node.classList.toggle('wv-selected', set.has(idOf(node)));
    updateButtons();
  }

  function updateButtons() {
    if (!ui) return;
    const none = selected.ids.length === 0;
    for (const name of ['explainSelection', 'translateSelection', 'edit']) ui.buttons[name].disabled = none;
  }

  function notice(text) {
    if (!shown) return;
    clearTimeout(noticeTimer);
    ui.status.className = 'wv-ocr-status';
    ui.status.textContent = text;
    placeTools(current.area);
    noticeTimer = setTimeout(() => {
      if (!shown) return;
      ui.status.textContent = t('ocrResult', { count: shown.result.words.length });
      placeTools(current.area);
    }, NOTICE_MS);
  }

  /** A phrase was chosen: shown, and handed on to be translated. */
  function choose(startId, endId) {
    const { ids, clamped } = WV.ocrPhrase.range(shown.result.words, startId, endId);
    if (ids.length === 0) return;
    select(ids);
    if (clamped) notice(t('ocrSelectionOneBlock'));
    WV.ocrLayer.setActive(null);
    shown.onPhrase(ids);
  }

  function onPointerDown(event) {
    const node = wordNode(event);
    if (!node || event.button !== 0 || !shown || editing) return;
    // No text selection, no focus taken from the page, and nothing for the page to act on.
    event.preventDefault();
    event.stopPropagation();
    const id = idOf(node);
    if (event.shiftKey && selected.anchor !== null && wordById(selected.anchor)) {
      choose(selected.anchor, id);
      return;
    }
    press = { id, x: event.clientX, y: event.clientY, pointerId: event.pointerId, dragging: false };
    node.setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event) {
    if (!press || event.pointerId !== press.pointerId) return;
    event.stopPropagation();
    if (!press.dragging) {
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < DRAG_DISTANCE) return;
      press.dragging = true;
      ui.words.classList.add('wv-dragging');
      WV.popup?.close();
    }
    const id = wordIdAt(event.clientX, event.clientY);
    if (id === null) return;
    select(WV.ocrPhrase.range(shown.result.words, press.id, id).ids, { anchor: press.id });
  }

  function onPointerUp(event) {
    if (!press || event.pointerId !== press.pointerId) return;
    event.stopPropagation();
    const { id, dragging } = press;
    cancelPress();
    const end = wordIdAt(event.clientX, event.clientY);
    if (dragging && end !== null && end !== id) {
      choose(id, end);
      return;
    }
    if (dragging && selected.ids.length > 1) {
      // let go between words: the phrase is what was marked last
      shown.onPhrase(selected.ids);
      return;
    }
    // A click: the word, as before. It is where a Shift+click extends from.
    select([], { anchor: id });
    const node = nodeById(id);
    const word = wordById(id);
    if (node && word) shown.onWord(word, node);
  }

  function cancelPress() {
    if (press) {
      try {
        nodeById(press.id)?.releasePointerCapture?.(press.pointerId);
      } catch {
        // already released
      }
    }
    press = null;
    ui?.words.classList.remove('wv-dragging');
  }

  function onDoubleClick(event) {
    const node = wordNode(event);
    if (!node || !shown || editing) return;
    event.preventDefault();
    event.stopPropagation();
    const word = wordById(idOf(node));
    const line = shown.result.lines.find((candidate) => candidate.id === word?.lineId);
    if (!line || line.words.length === 0) return;
    selected.anchor = line.words[0];
    choose(line.words[0], line.words[line.words.length - 1]);
  }

  // --- Correcting the phrase ---------------------------------------------------------------------

  function onEditKey(event) {
    if (event.isComposing) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      finishEdit(true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      finishEdit(false);
    }
  }

  function finishEdit(keep) {
    if (!editing) return;
    const { resolve } = editing;
    editing = null;
    const text = ui.editInput.value.replace(/\s+/g, ' ').trim();
    ui.edit.hidden = true;
    ui.actions.hidden = false;
    if (current) placeTools(current.area);
    resolve(keep && text ? text : null);
  }

  /**
   * Lets the user correct what was read before it is translated or explained.
   * @param {string} text  The phrase as read.
   * @returns {Promise<string | null>} The corrected text; null when they cancelled.
   */
  function edit(text) {
    if (!shown) return Promise.resolve(null);
    if (editing) finishEdit(false);
    return new Promise((resolve) => {
      editing = { resolve };
      ui.editInput.value = text;
      ui.actions.hidden = true;
      ui.edit.hidden = false;
      placeTools(current.area);
      ui.editInput.focus();
      ui.editInput.select();
    }).then((corrected) => {
      if (corrected !== null) selected.edited = corrected;
      return corrected;
    });
  }

  function open(area) {
    ui ||= build();
    if (!current) {
      window.addEventListener('keydown', onKeyDown, true);
      window.addEventListener('scroll', onScroll, { passive: true });
    }
    current = { area, scrollX: window.scrollX, scrollY: window.scrollY, onClose: current?.onClose || null, onTranslate: null };
    clearTranslation();
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
    forgetResult();
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
   * @param {(ids: number[]) => void} [options.onPhrase]  Words were selected together.
   * @param {(name: 'explainAll' | 'explainSelection' | 'translateSelection' | 'edit') => void} [options.onAction]
   *        A button of the bar was pressed.
   * @param {() => void} [options.onTranslate]  "Translate" was pressed; there is no such button without it.
   */
  function showResult(result, { showBoxes = false, onWord = () => {}, onPhrase = () => {}, onAction = () => {}, onTranslate = null } = {}) {
    open(result.area);
    forgetResult();
    shown = { result, onWord, onPhrase, onAction };
    current.onTranslate = onTranslate;
    ui.translate.hidden = !onTranslate;
    ui.layer.classList.toggle('wv-ocr-boxes', showBoxes);
    const nodes = result.words.map((word) => {
      const node = h('span', {
        class: 'wv-ocr-word',
        'data-word': String(word.id),
        dir: 'auto',
        text: word.text,
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
    ui.actions.hidden = false;
    updateButtons();
    placeTools(result.area);
  }

  /** What belongs to the result on screen goes with it. */
  function forgetResult() {
    if (editing) finishEdit(false);
    cancelPress();
    clearTimeout(noticeTimer);
    shown = null;
    selected = { ids: [], anchor: null, edited: null };
    if (ui) {
      ui.actions.hidden = true;
      ui.edit.hidden = true;
    }
  }

  /** @param {string} message  Localized. */
  function showError(area, message) {
    open(area);
    forgetResult();
    ui.words.replaceChildren();
    ui.status.className = 'wv-ocr-status wv-ocr-error';
    ui.status.textContent = message;
    placeTools(area);
  }

  // --- The translation over the picture ---------------------------------------------------------

  function clearTranslation() {
    if (!ui) return;
    ui.translations.replaceChildren();
    ui.translations.hidden = true;
    ui.views.hidden = true;
    ui.translate.hidden = true;
    ui.translate.disabled = false;
  }

  /** Shows the translation (true) or the page as it is (false); nothing is asked for again. */
  function setView(translated) {
    if (!ui || ui.translations.childElementCount === 0) return;
    ui.translations.hidden = !translated;
    ui.original.setAttribute('aria-pressed', String(!translated));
    ui.translated.setAttribute('aria-pressed', String(translated));
  }

  /** "Translate" is under way; the button waits. */
  function showTranslating(text) {
    if (!current) return;
    ui.translate.disabled = true;
    ui.status.className = 'wv-ocr-status';
    ui.status.replaceChildren(h('span', { class: 'wv-spinner' }), text);
    placeTools(current.area);
  }

  /** "Translate" failed: said in the status line, and the button can be pressed again. */
  function showTranslateError(message) {
    if (!current) return;
    ui.translate.disabled = false;
    ui.status.className = 'wv-ocr-status wv-ocr-error';
    ui.status.textContent = message;
    placeTools(current.area);
  }

  /**
   * Writes translations over the blocks they were made from.
   * @param {{ rect: Object, text: string, lines: number, colours?: { background: string, text: string } }[]} items
   *        rect: the block, in CSS px of the viewport at the time of the scan (as the words' boxes).
   * @param {{ lang?: string, status?: string }} [options]
   */
  function showTranslation(items, { lang = '', status = '' } = {}) {
    if (!current) return;
    const boxes = items
      .filter((item) => item.text)
      .map((item) => {
        // A little larger than the letters, so that their edges do not show around it.
        const rect = { x: item.rect.x - 2, y: item.rect.y - 2, width: item.rect.width + 4, height: item.rect.height + 4 };
        const box = h('div', { class: 'wv-ocr-tr', dir: 'auto', lang: lang || null, text: item.text });
        place(box, rect);
        box.style.background = item.colours?.background || '#ffffff';
        box.style.color = item.colours?.text || '#111111';
        box.dataset.lines = String(Math.max(1, item.lines || 1));
        return box;
      });
    ui.translations.replaceChildren(...boxes);
    ui.translations.hidden = false;
    // As large as the original letters, made smaller until the translation fits the block.
    for (const box of boxes) {
      let size = Math.max(8, ((box.clientHeight - 2) / Number(box.dataset.lines)) * 0.82);
      box.style.fontSize = `${size}px`;
      for (let step = 0; step < 14 && box.scrollHeight > box.clientHeight + 1 && size > 7; step++) {
        size *= 0.9;
        box.style.fontSize = `${size}px`;
      }
      // Still too long at the smallest size: the box grows downwards rather than cut the text.
      if (box.scrollHeight > box.clientHeight + 1) box.style.height = `${box.scrollHeight}px`;
    }
    ui.translate.hidden = true;
    ui.translate.disabled = false;
    ui.views.hidden = false;
    setView(true);
    if (status) {
      ui.status.className = 'wv-ocr-status';
      ui.status.textContent = status;
    }
    placeTools(current.area);
  }

  function hide() {
    if (!current) return;
    const { onClose } = current;
    forgetResult();
    current = null;
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('scroll', onScroll);
    ui.words.replaceChildren();
    clearTranslation();
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
    edit,
    /** The phrase selected on screen: its words, and the text as the user corrected it (null: as read). */
    selection: () => ({ ids: [...selected.ids], edited: selected.edited }),
    rectOf,
    wordIdAt,
    showBusy,
    showResult,
    showError,
    showTranslating,
    showTranslateError,
    showTranslation,
    setView,
    hide,
    isOpen: () => Boolean(current),
    /** Called once when the layer that is on screen goes away. */
    onClose(listener) {
      if (current) current.onClose = listener;
    },
  };
})(globalThis.WV);
