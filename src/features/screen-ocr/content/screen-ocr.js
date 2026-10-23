'use strict';

// Screen text scanning, the part in the page: choose an area, ask the background script to
// photograph and read it, lay the text over the place it was read from, and open the
// translation bubble for the word that is clicked. The picture is taken and handled in the
// extension's own context; only the words and their boxes come back here.
//
// Words selected together (layer.js) open the bubble as a phrase. The bar over the area offers
// to explain all of it or the phrase with AI (ai/background.js): only the text that was read is
// sent, never the picture, and only when the user presses the button and has agreed to it.

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
  let overFields = false; // the area covers a field the user types into: nothing of it goes to an AI

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
      return {
        text,
        line: line ? line.text : text,
        rect: WV.ocrLayer.rectOf([word.id]),
        area: blockRect && blockRect.height <= window.innerHeight * 0.3 ? blockRect : lineRect,
        // Read with one language: that is the language. With several, the line decides.
        lang: scanLanguage(),
        key: `ocr:${word.id}`,
      };
    },
  });

  /** Language of the text, where the scan was read with one. */
  function scanLanguage() {
    const codes = String(result?.info.languages || '').split('+');
    return codes.length === 1 ? LANGUAGE_TAGS[codes[0]] || '' : '';
  }

  /**
   * Whether the scanned area covers a password field or a field the user types into. What was
   * read there may be what they typed: it is translated if they ask, never offered to an AI.
   */
  function coversFields(area) {
    const right = area.x + area.width;
    const bottom = area.y + area.height;
    const fields = document.querySelectorAll('input:not([type=hidden]):not([type=button]):not([type=submit]):not([type=reset]):not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([type=file]):not([type=image]), textarea, [contenteditable=""], [contenteditable="true"]');
    for (const field of fields) {
      const box = field.getBoundingClientRect();
      if (box.width > 0 && box.height > 0 && box.left < right && box.right > area.x && box.top < bottom && box.bottom > area.y) return true;
    }
    return false;
  }

  /** All that was read, block by block in reading order, one block per line. */
  const wholeText = () => result.blocks.map((block) => WV.ocrPhrase.join(result.words, block.words)).filter(Boolean).join('\n');

  /**
   * Opens the bubble for a phrase of the scan, or all of it.
   * @param {{ ids: number[], text: string, explain?: boolean }} phrase  explain: ask the AI at once.
   */
  function openPhrase({ ids, text, explain = false }) {
    const rect = WV.ocrLayer.rectOf(ids);
    if (!rect || !text) return;
    WV.popup.open({
      text,
      range: null,
      rect,
      avoid: rect,
      point: { x: rect.left, y: rect.bottom },
      mode: 'passage',
      sentence: text,
      sample: text,
      pageLang: scanLanguage(),
      origin: 'screen',
      fromField: overFields,
      autoExplain: explain,
    });
  }

  /** The phrase selected on screen, as read or as corrected. */
  function selectedPhrase() {
    const { ids, edited } = WV.ocrLayer.selection();
    return ids.length === 0 ? null : { ids, text: edited || WV.ocrPhrase.join(result.words, ids) };
  }

  async function onAction(name) {
    if (!result) return;
    if (name === 'explainAll') {
      openPhrase({ ids: result.words.map((word) => word.id), text: wholeText(), explain: true });
      return;
    }
    const phrase = selectedPhrase();
    if (!phrase) return;
    if (name === 'edit') {
      WV.popup?.close();
      const corrected = await WV.ocrLayer.edit(phrase.text);
      if (corrected && result) openPhrase({ ids: phrase.ids, text: corrected });
      return;
    }
    openPhrase({ ...phrase, explain: name === 'explainSelection' });
  }

  function onPhrase(ids) {
    if (!result) return;
    const phrase = selectedPhrase() || { ids, text: WV.ocrPhrase.join(result.words, ids) };
    openPhrase(phrase);
  }

  function openWord(word, element) {
    const rect = element.getBoundingClientRect();
    const hit = WV.wordSource.normalise(source.wordAt({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }), source.id);
    if (!hit) return;
    WV.ocrLayer.setActive(element);
    WV.popup.openForHit(hit, { fromField: overFields, origin: 'screen' });
  }

  /** Lines of a translated passage (one per block that was sent). */
  const linesOf = (text) =>
    String(text || '')
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);

  /**
   * "Translate": every block of the scan, translated and written over the block. One request
   * for all of them, a block per line; if the service joined or split lines, block by block.
   */
  async function translateScan() {
    const found = result;
    if (!found) return;
    const blocks = found.blocks.filter((block) => block.text.trim());
    if (blocks.length === 0) return;
    const texts = blocks.map((block) => block.text.replace(/\s+/g, ' ').trim());
    const pageLang = scanLanguage();
    WV.ocrLayer.showTranslating(t('ocrTranslating'));
    try {
      const ask = (text) => WV.translateClient.translate({ text, passage: true, pageLang });
      const data = await ask(texts.join('\n'));
      if (data.sameLanguage) {
        // Nothing to write over it: the same words again would only cover the picture.
        if (result === found) WV.ocrLayer.showTranslateError(t('noteSameLanguage', { language: WV.languages.name(data.targetLang) }));
        return;
      }
      let translations = linesOf(data.translation);
      if (translations.length !== texts.length) {
        translations =
          texts.length === 1
            ? [translations.join(' ')]
            : await Promise.all(texts.map((text) => ask(text).then((answer) => (answer.sameLanguage ? text : linesOf(answer.translation).join(' ')))));
      }
      if (result !== found) return; // closed, or scanned again, meanwhile
      const lineCount = (block) => new Set(block.words.map((id) => found.words.find((word) => word.id === id)?.lineId)).size;
      WV.ocrLayer.showTranslation(
        blocks.map((block, index) => ({ rect: block.rect, text: translations[index], lines: lineCount(block), colours: block.colours })),
        { lang: data.targetLang, status: t('ocrResult', { count: found.words.length }) },
      );
    } catch (error) {
      if (result !== found) return;
      WV.ocrLayer.showTranslateError(t('ocrTranslateFailed', { reason: error?.detail || error?.code || '' }));
    }
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
        overFields = coversFields(found.area);
        WV.ocrLayer.showResult(found, { showBoxes: settings.ocrShowBoxes === true, onWord: openWord, onPhrase, onAction, onTranslate: translateScan });
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

  WV.screenOcr = { start, source, translate: translateScan };
})(globalThis.WV);
