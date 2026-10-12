'use strict';

// Connects a word source to the pointer and to the translation bubble: asks the source which
// word is under the pointer, marks it, and opens the bubble once the pointer has rested on it.
// It knows nothing about where the words come from; see word-source.js for the contract.

(function (WV) {
  if (!WV.supported || WV.hover) return;

  /**
   * @param {Object} options
   * @param {Object} options.source  A word source (WV.wordSource.define).
   * @returns {{ stop(): void }}
   */
  function start({ source }) {
    let frame = 0;
    let latest = null; // the last pointer event not yet looked at

    const tracker = WV.createHoverTracker({
      onTarget: (hit) => WV.highlight.show(hit ? hit.range : null),
      onShow: (hit) => WV.popup.openForHit(hit),
    });

    function look() {
      frame = 0;
      const event = latest;
      latest = null;
      if (!event) return;
      if (!chrome.runtime?.id) {
        stop(); // the extension was reloaded; this copy of the script is orphaned
        return;
      }
      // On the bubble itself: whatever is under it does not count.
      if (WV.popup.containsEvent(event)) return;
      const target = event.target instanceof Element ? event.target : null;
      let hit = null;
      try {
        hit = WV.wordSource.normalise(source.wordAt({ x: event.clientX, y: event.clientY, target }), source.id);
      } catch {
        // A source that fails on some text is the same as no word there.
      }
      tracker.move(hit);
    }

    // One look per frame, however many move events the browser delivers.
    function onMove(event) {
      if (!event.isTrusted) return; // a page cannot script lookups
      latest = event;
      if (!frame) frame = requestAnimationFrame(look);
    }

    function onLeave() {
      latest = null;
      tracker.reset();
    }

    const unsubscribe = source.subscribe((event) => {
      if (event?.type === 'gone') tracker.reset();
    });
    // Capture phase: players stop the propagation of pointer events on their controls.
    window.addEventListener('mousemove', onMove, { capture: true, passive: true });
    document.documentElement.addEventListener('mouseleave', onLeave, { passive: true });

    function stop() {
      window.removeEventListener('mousemove', onMove, { capture: true });
      document.documentElement.removeEventListener('mouseleave', onLeave);
      unsubscribe();
      cancelAnimationFrame(frame);
      frame = 0;
      tracker.reset();
    }

    return { stop };
  }

  WV.hover = { start };
})(globalThis.WV);
