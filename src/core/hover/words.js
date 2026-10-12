'use strict';

// Finding the word at a position in a piece of text. Nothing here touches a page: the text
// comes from wherever a word source read it (a caption today, recognised text of a picture
// later), so the same rules apply to all of them.

(function (WV) {
  if (WV.words) return;

  /** A word has a letter in it: "42", "…" and "♪" are not something to look up. */
  const HAS_LETTER = /\p{L}/u;
  /** Without Intl.Segmenter: runs of letters, with the marks and joiners that belong to them. */
  const WORD_FALLBACK = /[\p{L}\p{M}\p{N}]+(?:['’\-][\p{L}\p{M}\p{N}]+)*/gu;
  /** Descriptions of sounds, as captions write them: [Music], [applause]. Not spoken words. */
  const SOUND_CUE = /\[[^\]]*\]|［[^］]*］/gu;

  const segmenters = new Map();

  function segmenterFor(locale) {
    if (typeof Intl === 'undefined' || typeof Intl.Segmenter !== 'function') return null;
    const key = locale || '';
    if (!segmenters.has(key)) {
      let segmenter = null;
      try {
        segmenter = new Intl.Segmenter(locale || undefined, { granularity: 'word' });
      } catch {
        // Not a language tag the browser knows: its default rules still find word boundaries.
        segmenter = locale ? segmenterFor('') : null;
      }
      segmenters.set(key, segmenter);
    }
    return segmenters.get(key);
  }

  /** Where the sound cues are: [start, end) pairs. */
  function cueSpans(text) {
    return [...text.matchAll(SOUND_CUE)].map((match) => [match.index, match.index + match[0].length]);
  }

  /**
   * The words of a text, in order. Languages written without spaces (Japanese, Chinese, Thai)
   * are split by the browser's dictionary, which is why Intl.Segmenter comes first.
   *
   * @param {string} text
   * @param {string} [locale]  Language of the text, if known.
   * @returns {{ text: string, start: number, end: number }[]}
   */
  function split(text, locale) {
    const value = String(text || '');
    const cues = cueSpans(value);
    const inCue = (start, end) => cues.some(([from, to]) => start >= from && end <= to);
    const words = [];
    const segmenter = segmenterFor(locale);
    if (segmenter) {
      for (const part of segmenter.segment(value)) {
        if (part.isWordLike === false || !HAS_LETTER.test(part.segment)) continue;
        words.push({ text: part.segment, start: part.index, end: part.index + part.segment.length });
      }
    } else {
      for (const match of value.matchAll(WORD_FALLBACK)) {
        if (HAS_LETTER.test(match[0])) words.push({ text: match[0], start: match.index, end: match.index + match[0].length });
      }
    }
    return words.filter((word) => !inCue(word.start, word.end));
  }

  /**
   * The word that the character at `index` belongs to; null between words, on punctuation, on
   * a music note, inside a sound cue.
   *
   * @param {string} text
   * @param {number} index   Position of a character (not of a gap between two characters).
   * @param {string} [locale]
   */
  function at(text, index, locale) {
    if (!(index >= 0)) return null;
    return split(text, locale).find((word) => index >= word.start && index < word.end) || null;
  }

  /**
   * Several pieces of text read as one, remembering which piece each character came from.
   * A caption line is often drawn in several pieces, sometimes one per word, sometimes cutting
   * through what is one word to the reader.
   *
   * @param {string[]} pieces
   * @returns {{ text: string, indexOf(piece: number, offset: number): number,
   *             locate(index: number, end?: boolean): { piece: number, offset: number } | null }}
   */
  function join(pieces) {
    const starts = [];
    let text = '';
    for (const piece of pieces) {
      starts.push(text.length);
      text += piece;
    }
    return {
      text,
      indexOf: (piece, offset) => (piece >= 0 && piece < pieces.length ? starts[piece] + offset : -1),
      /**
       * `end`: the position closes a range, so on a boundary it belongs to the piece before
       * (the end of "to" in ["to", " say"] is in "to", not at the start of " say").
       */
      locate(index, end = false) {
        if (index < 0 || index > text.length) return null;
        for (let piece = pieces.length - 1; piece >= 0; piece--) {
          const fits = end ? index > starts[piece] : index >= starts[piece];
          if (fits && pieces[piece].length > 0) return { piece, offset: Math.min(index - starts[piece], pieces[piece].length) };
        }
        return pieces.length > 0 && index === 0 ? { piece: 0, offset: 0 } : null;
      },
    };
  }

  /** Spaces and line breaks collapsed: what a line of text reads as. */
  const tidy = (text) => String(text || '').replace(/\s+/g, ' ').trim();

  WV.words = { split, at, join, tidy };
})(globalThis.WV);
