'use strict';

// Decides when the translation popup opens. Loaded last: everything it needs is on WV by now.

(function (WV) {
  if (!WV.supported || WV.triggers) return;
  WV.triggers = true;

  /** A double-click selects one word; anything longer is not what this trigger is for. */
  const MAX_WORD_CHARS = 80;
  /** Frames smaller than this (ad slots, tracking iframes) cannot fit the popup. */
  const MIN_VIEWPORT_WIDTH = 240;
  const MIN_VIEWPORT_HEIGHT = 140;
  /** Tolerance, in px, when checking that the pointer is on the selected word. */
  const POINTER_SLACK = 4;

  // Settings are read straight from storage: a message to the background script on every page
  // load, in every frame, would keep waking it up for nothing. lib/settings.js owns the
  // defaults; a missing value means "enabled" here, which is the same default.
  const settings = { doubleClick: true };

  function applySettings(stored) {
    settings.doubleClick = stored?.doubleClick !== false;
  }

  chrome.storage.local.get('settings').then(
    (items) => applySettings(items.settings),
    () => {},
  );
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.settings) return;
    applySettings(changes.settings.newValue);
    WV.popup.resetLanguages();
  });

  /**
   * A double-click on empty space can leave an earlier selection in place or, in some browsers,
   * select the nearest word. Only a click on the selected text itself counts as a lookup.
   */
  function isOnSelection(range, x, y) {
    const rects = [...range.getClientRects()];
    if (rects.length === 0) return true; // no geometry (e.g. inside a shadow tree): cannot tell
    return rects.some(
      (rect) =>
        x >= rect.left - POINTER_SLACK &&
        x <= rect.right + POINTER_SLACK &&
        y >= rect.top - POINTER_SLACK &&
        y <= rect.bottom + POINTER_SLACK,
    );
  }

  function onDoubleClick(event) {
    // isTrusted: only real user input counts, a page cannot script lookups.
    if (!settings.doubleClick || !event.isTrusted || event.button !== 0) return;
    if (!chrome.runtime?.id) return; // the extension was reloaded; this copy of the script is orphaned
    if (window.innerWidth < MIN_VIEWPORT_WIDTH || window.innerHeight < MIN_VIEWPORT_HEIGHT) return;
    if (WV.popup.containsEvent(event) || WV.selection.isEditable(event)) return;

    const selection = window.getSelection();
    const text = WV.selection.tidyWord(selection?.toString());
    if (!text || text.length > MAX_WORD_CHARS || !/\p{L}/u.test(text)) return;

    const range = selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
    if (range && !isOnSelection(range, event.clientX, event.clientY)) return;
    const pageLang = WV.selection.languageOf(range?.startContainer || event.target);
    WV.popup.open({
      text,
      range,
      point: { x: event.clientX, y: event.clientY },
      pageLang,
      ...WV.selection.context(range, pageLang),
    });
  }

  // Capture phase, so the trigger still works on pages that stop propagation of the event.
  window.addEventListener('dblclick', onDoubleClick, true);
})(globalThis.WV);
