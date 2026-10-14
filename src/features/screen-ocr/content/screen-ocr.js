'use strict';

// Screen text scanning, the part in the page: choose an area, ask the background script to
// photograph and read it, lay the text over the place it was read from, and open the
// translation bubble for the word that is clicked. The picture is taken and handled in the
// extension's own context; only the words and their boxes come back here.

(function (WV) {
  // Top frame only: the screenshot is of the whole tab, and so is the selection.
  if (!WV.supported || !WV.ocrSelector || WV.screenOcr || window.top !== window) return;
  const { t } = WV;

  const LAST_AREA_KEY = 'ocrLastArea';
  const ERROR_MESSAGES = {
    ocr_forbidden: 'ocrErrForbidden',
    ocr_rate: 'ocrErrRate',
    ocr_capture: 'ocrErrCapture',
    ocr_no_text: 'ocrErrNoText',
    ocr_blank: 'ocrErrBlank',
    ocr_engine: 'ocrErrEngine',
    context_invalidated: 'errContextInvalidated',
  };
  /** Engine language code → the tag the translation popup understands. */
  const LANGUAGE_TAGS = { eng: 'en', tur: 'tr' };

  let busy = false;
  let pending = null; // the area being read
  let result = null; // what is on screen: words, lines, blocks

  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
  /** The word without the punctuation the engine attached to it. */
  const lookupText = (text) => String(text || '').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

  /** What the page knows about its viewport; the background script measures the rest from the picture. */
  function viewportNow() {
    const visual = window.visualViewport;
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
      scale: visual?.scale || 1,
      offsetLeft: visual?.offsetLeft || 0,
      offsetTop: visual?.offsetTop || 0,
    };
  }

  async function stored() {
    try {
      const items = await chrome.storage.local.get(['settings', LAST_AREA_KEY]);
      return { settings: items.settings || {}, lastArea: items[LAST_AREA_KEY] || null };
    } catch {
      return { settings: {}, lastArea: null };
    }
  }

  // The scanned text as a word source (core/hover/word-source.js): the same contract the
  // captions use, answered from recognised boxes instead of the page's DOM. The bubble, the
  // vault and the context kept with a word depend on the contract only.
  const source = WV.wordSource.define({
    id: 'screen-ocr',
    wordAt({ x, y }) {
      if (!result) return null;
      const id = WV.ocrLayer.wordIdAt(x, y);
      const word = id === null ? null : result.words.find((candidate) => candidate.id === id);
      const text = word ? lookupText(word.text) : '';
      if (!text) return null;
      const line = result.lines.find((candidate) => candidate.id === word.lineId);
      // What the bubble keeps clear of: the whole block (both rows of a caption), unless the
      // block is a large part of the screen (a page of text), in which case the line.
      const block = result.blocks.find((candidate) => candidate.id === word.blockId);
      const blockRect = block ? WV.ocrLayer.rectOf(block.words) : null;
      const lineRect = line ? WV.ocrLayer.rectOf(line.words) : null;
      const codes = String(result.info.languages || '').split('+');
      return {
        text,
        line: line ? line.text : text,
        rect: WV.ocrLayer.rectOf([word.id]),
        area: blockRect && blockRect.height <= window.innerHeight * 0.3 ? blockRect : lineRect,
        // Read with one language: that is the language. With several, the line decides.
        lang: codes.length === 1 ? LANGUAGE_TAGS[codes[0]] || '' : '',
        key: `ocr:${word.id}`,
      };
    },
  });

  function openWord(word, element) {
    const rect = element.getBoundingClientRect();
    const hit = WV.wordSource.normalise(source.wordAt({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }), source.id);
    if (!hit) return;
    WV.ocrLayer.setActive(element);
    WV.popup.openForHit(hit);
  }

  function showError(area, error) {
    result = null;
    WV.ocrLayer.showError(area, t(ERROR_MESSAGES[error?.code] || 'ocrErrEngine'));
  }

  async function start() {
    if (busy || WV.ocrSelector.isOpen()) return;
    WV.popup?.close();
    WV.ocrLayer.hide();
    result = null;
    const { settings, lastArea } = await stored();
    const chosen = await WV.ocrSelector.choose({ initial: settings.ocrRememberArea === true ? lastArea : null });
    if (chosen === undefined) return; // cancelled

    const viewport = viewportNow();
    const area = chosen || { x: 0, y: 0, width: viewport.innerWidth, height: viewport.innerHeight };
    if (chosen) chrome.storage.local.set({ [LAST_AREA_KEY]: chosen }).catch(() => {});
    busy = true;
    pending = area;
    try {
      // The selector is off the page now, but not yet off the screen: the picture is taken
      // only after the browser has drawn the page without it.
      await nextFrame();
      await nextFrame();
      const found = await WV.send('wv:ocr:scan', { area: chosen, viewport });
      if (found.words.length === 0) {
        showError(found.area, { code: 'ocr_no_text' });
      } else {
        result = found;
        WV.ocrLayer.showResult(found, { showBoxes: settings.ocrShowBoxes === true, onWord: openWord });
        WV.ocrLayer.onClose(() => {
          result = null;
          source.emit({ type: 'gone' });
          WV.popup?.close();
        });
      }
    } catch (error) {
      showError(area, error);
    } finally {
      busy = false;
      pending = null;
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'wv:ocr:start') start();
    // The picture has been taken: from here on something may be shown over the page again.
    else if (message?.type === 'wv:ocr:stage' && busy && pending) {
      const percent = String(Math.round(Math.max(0, Math.min(1, Number(message.progress) || 0)) * 100));
      WV.ocrLayer.showBusy(pending, t(message.stage === 'reading' ? 'ocrReadingPercent' : 'ocrLoadingData', { percent }));
    }
    return false;
  });

  WV.screenOcr = { start, source };
})(globalThis.WV);
