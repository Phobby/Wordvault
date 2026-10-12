'use strict';

// Marks the word under the pointer with the CSS Custom Highlight API: the browser paints over a
// Range, so the text that is highlighted is not touched. Where the API is missing there is no
// highlight and everything else works as before.

(function (WV) {
  if (!WV.supported || WV.highlight) return;

  const NAME = 'wordvault-hover';
  const RULE = `::highlight(${NAME}) { background-color: rgba(255, 204, 0, 0.5); }`;

  let ready = null; // null: not tried yet

  /** Registers the highlight's style once. A constructed sheet adds no element to the page. */
  function prepare() {
    if (ready !== null) return ready;
    ready = false;
    try {
      if (typeof CSS === 'undefined' || !CSS.highlights || typeof Highlight !== 'function') return ready;
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(RULE);
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      ready = true;
    } catch {
      // No highlight in this browser or on this page.
    }
    return ready;
  }

  /** @param {Range | null} range  The word to mark; null takes the mark away. */
  function show(range) {
    if (!range) {
      clear();
      return;
    }
    if (!prepare()) return;
    try {
      CSS.highlights.set(NAME, new Highlight(range));
    } catch {
      ready = false;
    }
  }

  function clear() {
    if (!ready) return;
    try {
      CSS.highlights.delete(NAME);
    } catch {
      // Nothing to take away.
    }
  }

  WV.highlight = { show, clear, isAvailable: () => prepare() };
})(globalThis.WV);
