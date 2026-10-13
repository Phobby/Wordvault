'use strict';

// A selected sentence or paragraph, on the page: the small "Translate" button that appears
// next to a selection of more than one word, and the message by which the right-click menu and
// the keyboard shortcut ask this frame to translate what is selected in it.
//
// The button lives in a shadow tree of its own, takes no focus and swallows the press that
// lands on it, so the page's selection stays exactly as the user made it.

(function (WV) {
  if (!WV.supported || WV.translateButton) return;
  const { h, t, icon } = WV;

  /** The selection has to stay as it is for this long before the button is shown. */
  const SETTLE_MS = 250;
  /** Distance between the end of the selection and the button, and between the button and the viewport edge. */
  const GAP = 6;
  const MARGIN = 6;
  /** Frames smaller than this (ad slots, tracking iframes) cannot fit the popup. */
  const MIN_VIEWPORT_WIDTH = 240;
  const MIN_VIEWPORT_HEIGHT = 140;
  /** A right-click counts as "where the menu was opened" for this long. */
  const MENU_POINT_MS = 60 * 1000;

  const ICON_TRANSLATE = 'M4 6h9M8.5 4v2M11 6c-.6 3.4-2.9 6.2-6.5 8M6.5 9.5c1 1.9 2.6 3.4 4.8 4.5M12.5 20l4-9 4 9M14 17h5';

  const CSS = `
    .wv-tb {
      position: absolute;
      left: 0;
      top: 0;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      margin: 0;
      padding: 4px 9px 4px 7px;
      border: 1px solid var(--wv-border);
      border-radius: 999px;
      background: var(--wv-bg);
      color: var(--wv-fg);
      box-shadow: 0 3px 10px rgba(0, 0, 0, 0.18), 0 1px 3px rgba(0, 0, 0, 0.12);
      font: 600 12px/1.3 system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      white-space: nowrap;
      cursor: pointer;
      user-select: none;
      -webkit-user-select: none;
      animation: wv-tb-in 0.12s ease-out;
    }
    .wv-tb:hover { background: color-mix(in srgb, var(--wv-accent) 12%, var(--wv-bg)); }
    .wv-tb .wv-icon { width: 15px; height: 15px; color: var(--wv-accent); }
    @keyframes wv-tb-in { from { opacity: 0; transform: translateY(3px); } }
    @media (prefers-reduced-motion: reduce) { .wv-tb { animation: none; } }
  `;

  let enabled = true;
  let ui = null; // { surface, button }, built on first use
  let shown = null; // { range, text } while the button is on screen
  let timer = 0;
  let frame = 0;
  let pointerDown = false;
  let menuPoint = null; // { x, y, at }: where the last right-click was

  const clamp = (value, min, max) => Math.max(min, Math.min(value, max));
  const alive = () => Boolean(chrome.runtime?.id); // false once the extension was reloaded under this page

  /** Whether a node is part of something the user types in. */
  function inEditable(node) {
    if (document.designMode === 'on') return true;
    const element = node && (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement);
    if (!element) return false;
    return element.isContentEditable || Boolean(element.closest('input, textarea, select, [role="textbox"]'));
  }

  /** The field the caret is in, if it is a plain text field. */
  function focusedField() {
    const element = document.activeElement;
    const name = element?.localName;
    return name === 'textarea' || (name === 'input' && typeof element.selectionStart === 'number') ? element : null;
  }

  /**
   * What is selected in this frame, however much it is.
   * @returns {{ text: string, range: Range | null, rect: DOMRect | null, editable: boolean } | null}
   */
  function selected() {
    const field = focusedField();
    if (field) {
      // Text fields keep their selection to themselves: there is no range, only the field.
      let text = '';
      try {
        text = field.value.slice(field.selectionStart, field.selectionEnd);
      } catch {
        text = ''; // a kind of input that has no selection
      }
      return text.trim() ? { text, range: null, rect: field.getBoundingClientRect(), editable: true } : null;
    }
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
    const text = selection.toString();
    if (!text.trim()) return null;
    const range = selection.getRangeAt(0).cloneRange();
    return { text, range, rect: null, editable: inEditable(range.commonAncestorContainer) };
  }

  /**
   * Opens the popup for a selection: as a passage, or, for a single word, the way a
   * double-click on that word does.
   * @returns {boolean} Whether there was something to open it for.
   */
  function openFor({ text, range = null, rect = null, point = null }) {
    const locale = WV.selection.languageOf(range?.startContainer || document.body);
    const anchor = point || { x: Math.round(window.innerWidth / 2 - 150), y: 80 };
    // Where the selection is now. Some pages draw their text again a moment after a click
    // (YouTube's description does), which leaves the range without a place; the popup then
    // stays where the text was instead of closing.
    const box = range ? range.getBoundingClientRect() : null;
    const place = rect || (box && (box.width > 0 || box.height > 0) ? new DOMRect(box.left, box.top, box.width, box.height) : null);
    if (WV.passageText.isPassage(text, locale)) {
      WV.popup.open({ text, range, rect: place, point: anchor, pageLang: locale, mode: 'passage' });
      return true;
    }
    const word = WV.selection.tidyWord(text);
    if (!word) return false;
    WV.popup.open({ text: word, range, rect: place, point: anchor, pageLang: locale, ...WV.selection.context(range, locale) });
    return true;
  }

  // --- The button ------------------------------------------------------------------------------

  function build() {
    const surface = WV.createSurface(CSS);
    const button = h('button', { class: 'wv-tb', type: 'button', tabindex: '-1', title: t('selTranslateHint') }, icon(ICON_TRANSLATE), h('span', { text: t('selTranslate') }));
    // The press must not reach the page: it would take the selection away before the click.
    for (const type of ['pointerdown', 'mousedown']) {
      button.addEventListener(type, (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
    }
    button.addEventListener('click', (event) => {
      // isTrusted: only the user's own click counts; a page cannot script a translation.
      if (!event.isTrusted || !shown) return;
      const { text, range } = shown;
      hide();
      if (alive()) openFor({ text, range });
    });
    surface.root.append(button);
    return { surface, button };
  }

  function hide() {
    clearTimeout(timer);
    timer = 0;
    cancelAnimationFrame(frame);
    frame = 0;
    if (!shown) return;
    shown = null;
    ui.surface.unmount();
  }

  /** Next to where the selection ends: after its last line, or before its first if that is where the user stopped. */
  function place() {
    if (!shown) return;
    const rects = [...shown.range.getClientRects()].filter((rect) => rect.width > 0 || rect.height > 0);
    const viewportWidth = Math.min(window.innerWidth, document.documentElement.clientWidth || Infinity);
    const viewportHeight = window.innerHeight;
    const visible = rects.filter((rect) => rect.bottom > 0 && rect.top < viewportHeight && rect.right > 0 && rect.left < viewportWidth);
    if (visible.length === 0) {
      hide();
      return;
    }
    const { offsetWidth: width, offsetHeight: height } = ui.button;
    const end = shown.backward ? visible[0] : visible[visible.length - 1];
    let left = shown.backward ? end.left - width - GAP : end.right + GAP;
    let top = shown.backward ? end.top - height - GAP : end.bottom + GAP;
    // No room beside it: under (or over) the line instead, so that it never covers the selection's end.
    if (left + width > viewportWidth - MARGIN) left = end.right - width;
    if (left < MARGIN) left = end.left;
    if (top + height > viewportHeight - MARGIN) top = end.top - height - GAP;
    ui.button.style.left = `${Math.round(clamp(left, MARGIN, viewportWidth - width - MARGIN))}px`;
    ui.button.style.top = `${Math.round(clamp(top, MARGIN, viewportHeight - height - MARGIN))}px`;
  }

  /** Shows the button if what is selected now is a passage; takes it away if not. */
  function check() {
    timer = 0;
    if (!enabled || !alive() || pointerDown || WV.popup.isOpen()) return hide();
    if (window.innerWidth < MIN_VIEWPORT_WIDTH || window.innerHeight < MIN_VIEWPORT_HEIGHT) return hide();
    const now = selected();
    // Not in text the user is editing: there a button popping up next to every selection is in the way.
    if (!now || !now.range || now.editable || !WV.passageText.isPassage(now.text, WV.selection.languageOf(now.range.startContainer))) return hide();
    const selection = window.getSelection();
    const backward = selection.focusNode === now.range.startContainer && selection.focusOffset === now.range.startOffset;
    ui ||= build();
    shown = { text: now.text, range: now.range, backward };
    ui.surface.mount(now.range.commonAncestorContainer);
    place();
  }

  function schedule() {
    clearTimeout(timer);
    timer = enabled && !pointerDown ? setTimeout(check, SETTLE_MS) : 0;
  }

  document.addEventListener('selectionchange', () => {
    // What the button was for is no longer what is selected: it goes at once, and comes back
    // (if there still is a passage) when the selection has settled.
    if (shown) {
      const now = window.getSelection();
      if (!now || now.isCollapsed || now.toString() !== shown.text) hide();
    }
    schedule();
  });
  window.addEventListener(
    'pointerdown',
    (event) => {
      if (ui?.surface.containsEvent(event)) return;
      if (event.button === 0) pointerDown = true;
      hide();
    },
    true,
  );
  const released = () => {
    pointerDown = false;
    schedule();
  };
  window.addEventListener('pointerup', released, true);
  window.addEventListener('pointercancel', released, true);
  window.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape') hide();
    },
    true,
  );
  const follow = () => {
    if (!shown || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      place();
    });
  };
  window.addEventListener('scroll', follow, { capture: true, passive: true });
  window.addEventListener('resize', follow);
  // Where the menu was opened is where the popup goes when the selection has no place of its own.
  window.addEventListener('contextmenu', (event) => (menuPoint = { x: event.clientX, y: event.clientY, at: Date.now() }), true);

  // --- Asked from outside: the right-click menu and the keyboard shortcut -------------------------

  /** Whether this frame is the one the user is in (and not one of the frames around it). */
  function hasTheFocus() {
    const name = document.activeElement?.localName;
    return document.hasFocus() && name !== 'iframe' && name !== 'frame';
  }

  try {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (sender.id !== chrome.runtime.id) return undefined;
      // "Are the scripts in this frame?": asked before they are put in where they are missing.
      if (message?.type === 'wv:passage:ping') {
        sendResponse(true);
        return undefined;
      }
      if (message?.type !== 'wv:passage:open') return undefined;
      const own = selected();
      // The shortcut is sent to every frame of the tab: only the one with the selection answers.
      if (!message.menu && !(own && hasTheFocus())) return undefined;
      hide();
      const recent = menuPoint && Date.now() - menuPoint.at < MENU_POINT_MS ? { x: menuPoint.x, y: menuPoint.y } : null;
      // The frame's own selection has line breaks and a place; what the browser passed along with the menu has neither.
      const text = own?.text || (typeof message.text === 'string' ? message.text : '');
      sendResponse(openFor({ text, range: own?.range || null, rect: own?.rect || null, point: message.menu ? recent : null }));
      return undefined;
    });
  } catch {
    // the extension was reloaded underneath this page
  }

  WV.translateButton = {
    /** The setting "Translate button on selection". */
    setEnabled(value) {
      enabled = value !== false;
      if (!enabled) hide();
    },
    isShown: () => Boolean(shown),
    /** False for a copy of these scripts that the extension was reloaded underneath. */
    alive,
  };
})(globalThis.WV);
