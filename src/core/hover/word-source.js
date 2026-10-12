'use strict';

// The contract between "something on screen that has words in it" and everything that happens
// once the pointer is on one of them (highlight, translation bubble, saving with its context).
//
// A word source answers one question, "which word is at this point of the screen?", and says
// when its text went away. Captions answer it from the page's DOM (features/captions). A source
// that reads text out of a picture would answer it from recognised boxes instead; nothing on
// the other side of this contract knows the difference.
//
//   WordSource
//     id          string     Name of the source, for the diagnostics.
//     wordAt(point)          → WordHit | null
//                            point: { x, y, target }: viewport coordinates and, if known, the
//                            element under the pointer. Has to be cheap when the pointer is
//                            nowhere near the source's text: it runs on pointer moves.
//     subscribe(listener)    → unsubscribe()
//                            listener({ type: 'gone' }): the text the last hits came from is
//                            no longer on screen (the caption changed, the video went away).
//
//   WordHit
//     text        string     The word.
//     line        string     The whole line or sentence around it: shown as its context,
//                            used to tell the language, kept with the word in the vault.
//     rect        DOMRect    Where the word is on screen, at the moment of the hit. Stays valid
//                            as a place to anchor to after the source redraws its text.
//     area        DOMRect?   The block of text the word is part of (all rows of a caption):
//                            what the bubble should not cover.
//     range       Range?     The word in the DOM, for sources that have one (highlighting).
//     lang        string?    Language of the text, when the source knows it.
//     key         string     The same for two hits on the same word of the same line, so
//                            that moving the pointer within a word is not a new hit.

(function (WV) {
  if (WV.wordSource) return;

  /**
   * Checks that an object is a usable word source and gives it the plumbing every source
   * needs for its listeners.
   *
   * @param {{ id: string, wordAt(point: { x: number, y: number, target?: Element | null }): Object | null }} implementation
   * @returns {Object} The source: the implementation plus `subscribe` and `emit`.
   */
  function define(implementation) {
    if (!implementation || typeof implementation.id !== 'string' || typeof implementation.wordAt !== 'function') {
      throw new TypeError('a word source needs an id and wordAt()');
    }
    const listeners = new Set();
    return {
      ...implementation,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      /** For the source itself: tells whoever listens what happened to its text. */
      emit(event) {
        for (const listener of [...listeners]) listener(event);
      },
    };
  }

  /** A hit as the rest of the pipeline may rely on it; null if the source returned nonsense. */
  function normalise(hit, sourceId) {
    if (!hit || typeof hit.text !== 'string' || hit.text === '' || !hit.rect) return null;
    const line = typeof hit.line === 'string' && hit.line !== '' ? hit.line : hit.text;
    return {
      text: hit.text,
      line,
      rect: hit.rect,
      area: hit.area || null,
      range: hit.range || null,
      lang: hit.lang || '',
      key: hit.key || `${line}\n${hit.text}`,
      source: sourceId,
    };
  }

  WV.wordSource = { define, normalise };
})(globalThis.WV);
