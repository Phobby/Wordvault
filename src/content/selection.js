'use strict';

// Helpers for reading what the user selected and the text around it.

(function (WV) {
  if (!WV.supported || WV.selection) return;

  /** Characters of surrounding text kept on each side of the selection. */
  const CONTEXT_RADIUS = 300;
  const MAX_SENTENCE_CHARS = 300;
  const SENTENCE_END = /(?<=[.!?…。！？])\s+/u;

  const tidy = (text) => String(text || '').replace(/\s+/g, ' ').trim();

  /** A double-click can pick up a trailing space or adjacent punctuation along with the word. */
  const tidyWord = (text) => tidy(text).replace(/^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu, '');

  /** Whether an event happened in a place where the user types or edits text. */
  function isEditable(event) {
    if (document.designMode === 'on') return true;
    for (const node of event.composedPath()) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const name = node.localName;
      if (name === 'input' || name === 'textarea' || name === 'select') return true;
      if (node.isContentEditable || node.getAttribute('role') === 'textbox') return true;
    }
    return false;
  }

  /** Closest ancestor that is laid out as a block, i.e. the paragraph the node belongs to. */
  function blockOf(node) {
    let element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    let block = element;
    while (element) {
      block = element;
      if (element === document.body) break;
      if (!/^(inline|contents|ruby)/.test(getComputedStyle(element).display)) break;
      element = element.parentElement;
    }
    return block;
  }

  function sentenceAt(text, index, locale) {
    if (typeof Intl.Segmenter === 'function') {
      try {
        const segmenter = new Intl.Segmenter(locale || undefined, { granularity: 'sentence' });
        for (const part of segmenter.segment(text)) {
          if (index < part.index + part.segment.length) return part.segment;
        }
      } catch {
        // Unknown locale tag: use the punctuation-based fallback below.
      }
    }
    return text.slice(0, index).split(SENTENCE_END).pop() + text.slice(index).split(SENTENCE_END)[0];
  }

  /**
   * Text around a selection:
   *   sentence - the sentence the selection sits in ('' if it could not be isolated),
   *   sample   - a wider window of text, only used for offline language detection.
   * Neither is ever sent to a translation service.
   *
   * @param {Range | null} range
   * @param {string} [locale] Language of the text, if known; improves sentence splitting.
   */
  function context(range, locale) {
    const empty = { sentence: '', sample: '' };
    if (!range) return empty;
    try {
      const block = blockOf(range.commonAncestorContainer);
      if (!block) return empty;
      const whole = document.createRange();
      whole.selectNodeContents(block);
      const before = whole.cloneRange();
      before.setEnd(range.startContainer, range.startOffset);

      const text = whole.toString();
      const start = before.toString().length;
      const selected = range.toString();
      const from = Math.max(0, start - CONTEXT_RADIUS);
      const to = Math.min(text.length, start + selected.length + CONTEXT_RADIUS);
      const nearby = text.slice(from, to);

      let sentence = tidy(sentenceAt(nearby, start - from, locale));
      // A selection that crosses sentence boundaries has no single containing sentence.
      if (sentence.length > MAX_SENTENCE_CHARS || !sentence.includes(tidy(selected))) sentence = '';
      return { sentence, sample: tidy(nearby) };
    } catch {
      return empty; // detached or otherwise unusable range
    }
  }

  /** Value of the closest `lang` attribute, falling back to the document language. */
  function languageOf(node) {
    const element = node && (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement);
    return element?.closest?.('[lang]')?.getAttribute('lang') || document.documentElement.lang || '';
  }

  WV.selection = { tidy, tidyWord, isEditable, blockOf, context, languageOf };
})(globalThis.WV);
