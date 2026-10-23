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
  /** Where a double-click is meant for the page, not a lookup, when no text was selected. */
  const CONTROLS = 'button, [role="button"], a[href], label, summary, select, option, video, audio, canvas, svg';

  // Settings are read straight from storage: a message to the background script on every page
  // load, in every frame, would keep waking it up for nothing. lib/settings.js owns the
  // defaults; a missing value means "enabled" here, which is the same default.
  const settings = { doubleClick: true };

  function applySettings(stored) {
    settings.doubleClick = stored?.doubleClick !== false;
    WV.translateButton?.setEnabled(stored?.selectionButton !== false);
    WV.inPlace?.setEnabled(stored?.passageInPlace !== false);
    WV.speech.options.ttsFallback = stored?.ttsFallback === true;
  }

  chrome.storage.local.get('settings').then(
    (items) => applySettings(items.settings),
    () => {},
  );
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.settings) return;
    applySettings(changes.settings.newValue);
    WV.popup.settingsChanged();
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

  /**
   * The word under a double-click when the browser selected nothing: the page does not let text
   * be selected (user-select: none, or a script that cancels or clears every selection, as
   * Cisco's courses do on any page with a quiz). The word is read from the text at the point;
   * the page's selection is left alone.
   */
  function wordUnder(event) {
    const target = event.composedPath()[0];
    if (!(target instanceof Element) || target.closest(CONTROLS)) return null;
    // A target inside an open shadow tree: the browser reports a caret there only for the trees it is told about.
    const shadowRoots = [];
    for (let root = target.getRootNode(); root && root !== document && root.host; root = root.host.getRootNode()) shadowRoots.push(root);
    const block = WV.selection.blockOf(target);
    const nodes = WV.textPoint.textNodes(block).filter((node) => node.parentElement && !node.parentElement.closest('script, style, noscript'));
    return WV.textPoint.wordAt({ x: event.clientX, y: event.clientY, nodes, locale: WV.selection.languageOf(target), shadowRoots });
  }

  function onDoubleClick(event) {
    // isTrusted: only real user input counts, a page cannot script lookups.
    if (!settings.doubleClick || !event.isTrusted || event.button !== 0) return;
    if (!chrome.runtime?.id) return; // the extension was reloaded; this copy of the script is orphaned
    if (window.innerWidth < MIN_VIEWPORT_WIDTH || window.innerHeight < MIN_VIEWPORT_HEIGHT) return;
    if (WV.popup.containsEvent(event) || WV.selection.isEditable(event)) return;

    const selection = window.getSelection();
    let text = WV.selection.tidyWord(selection?.toString());
    let range = text && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
    if (!text && WV.textPoint) {
      let hit = null;
      try {
        hit = wordUnder(event);
      } catch {
        // Text that cannot be measured; the same as a double-click on nothing.
      }
      text = WV.selection.tidyWord(hit?.text);
      range = hit?.range || null;
    }
    if (!text || text.length > MAX_WORD_CHARS || !/\p{L}/u.test(text)) return;
    // More than one word is a passage: that is what the "Translate" button, the right-click menu
    // and the shortcut are for (content/translate-button.js), not the word lookup.
    if (WV.passageText.isPassage(text)) return;

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
