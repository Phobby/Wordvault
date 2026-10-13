'use strict';

// One word, or more than one? A selection of one word is looked up as a word (with its
// alternatives, its sentence, the dictionary); a longer one is translated as a passage.
// Used wherever a selection arrives: the page, the right-click menu, the keyboard shortcut,
// the window that stands in on pages Wordvault cannot draw on.

(function (WV) {
  if (!WV || WV.passageText) return;

  /** Scripts written without spaces between words: there, spaces say nothing about how many words there are. */
  const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
  const WORDY = /[\p{L}\p{N}]/u;

  const tidy = (text) => String(text == null ? '' : text).replace(/\s+/g, ' ').trim();

  /**
   * How many words a text has: what stands between spaces and has a letter or digit in it
   * ("ice-cream", "don't" and "3.5" are one each), and for text written without spaces what
   * the browser's word finder makes of it.
   * @param {string} text
   * @param {string} [locale]
   * @returns {number}
   */
  function wordCount(text, locale) {
    const value = tidy(text);
    if (!value) return 0;
    const spaced = value.split(' ').filter((part) => WORDY.test(part)).length;
    if (spaced !== 1 || !UNSPACED.test(value)) return spaced;
    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
      try {
        let count = 0;
        for (const part of new Intl.Segmenter(locale || undefined, { granularity: 'word' }).segment(value)) if (part.isWordLike) count += 1;
        return count;
      } catch {
        // an unknown language tag: the rule of thumb below
      }
    }
    // ASSUMPTION: without a word finder, a run of more than three such characters is taken for more than one word.
    return [...value].filter((character) => UNSPACED.test(character)).length > 3 ? 2 : 1;
  }

  /** Whether a selection is translated as a passage (more than one word) rather than looked up as a word. */
  const isPassage = (text, locale) => wordCount(text, locale) > 1;

  WV.passageText = { tidy, wordCount, isPassage };
})(globalThis.WV);
