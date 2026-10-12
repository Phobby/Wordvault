'use strict';

// Decides, from the stream of "the pointer is on this word / on no word", when a word counts
// as hovered. No DOM and no timers of its own, so the rules can be tested as they are.

(function (WV) {
  if (WV.createHoverTracker) return;

  /** How long the pointer has to rest on a word before it is looked up. */
  const HOVER_DELAY_MS = 150;

  /**
   * @param {Object} options
   * @param {(hit: Object) => void} options.onShow        The word was hovered long enough.
   * @param {(hit: Object | null) => void} [options.onTarget]  The word under the pointer changed.
   * @param {number} [options.delay]
   * @param {(fn: Function, ms: number) => any} [options.setTimer]
   * @param {(id: any) => void} [options.clearTimer]
   */
  WV.createHoverTracker = function createHoverTracker({
    onShow,
    onTarget = () => {},
    delay = HOVER_DELAY_MS,
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (id) => clearTimeout(id),
  }) {
    let current = null; // the hit under the pointer
    let timer = null;
    let shownKey = null; // the word the bubble was last opened for, while the pointer is still on it

    function cancel() {
      if (timer !== null) clearTimer(timer);
      timer = null;
    }

    return {
      /** @param {Object | null} hit  What is under the pointer now. */
      move(hit) {
        const key = hit ? hit.key : null;
        if (key === (current ? current.key : null)) {
          if (hit) current = hit; // same word, fresher geometry
          return;
        }
        cancel();
        current = hit;
        shownKey = null;
        onTarget(hit);
        if (!hit) return;
        timer = setTimer(() => {
          timer = null;
          // Shown once per visit: closing the bubble with the pointer still on the word does
          // not bring it straight back.
          if (!current || current.key === shownKey) return;
          shownKey = current.key;
          onShow(current);
        }, delay);
      },
      /** The text under the pointer went away. */
      reset() {
        this.move(null);
      },
      get target() {
        return current;
      },
    };
  };

  WV.HOVER_DELAY_MS = HOVER_DELAY_MS;
})(globalThis.WV);
