'use strict';

// A stopwatch for "how long did the user look at this": it only runs while the page is in front
// of the user, that is, while the tab is visible and its window has the focus. Time spent in
// another tab or another application is not counted.

(function (WV) {
  if (WV.createStopwatch) return;

  /** The page as a source of time and attention. Tests pass their own. */
  const pageClock = {
    now: () => performance.now(),
    watching: () => document.visibilityState === 'visible' && document.hasFocus(),
    /** Calls `listener` whenever `watching()` may have changed. @returns {() => void} unsubscribe */
    subscribe(listener) {
      // Moving the focus into a frame of the page fires "blur" on the window although the page
      // still has the focus, so the events only say "look again"; watching() decides.
      const later = () => setTimeout(listener, 0);
      document.addEventListener('visibilitychange', listener);
      window.addEventListener('blur', listener);
      window.addEventListener('blur', later);
      window.addEventListener('focus', listener);
      return () => {
        document.removeEventListener('visibilitychange', listener);
        window.removeEventListener('blur', listener);
        window.removeEventListener('blur', later);
        window.removeEventListener('focus', listener);
      };
    },
  };

  /**
   * @param {typeof pageClock} [clock]
   * @returns {{ start(): void, elapsed(): number, stop(): void }}
   *   start(): begin counting (from now, or from the moment the page is next in front);
   *   elapsed(): whole milliseconds counted so far; stop(): freeze the count and let go of the page.
   */
  WV.createStopwatch = function createStopwatch(clock = pageClock) {
    let counted = 0;
    let runningSince = null; // clock time at which the current stretch began; null while paused
    let started = false;
    let unsubscribe = null;

    function look() {
      if (!started) return;
      const now = clock.now();
      if (clock.watching()) {
        if (runningSince === null) runningSince = now;
      } else if (runningSince !== null) {
        counted += Math.max(0, now - runningSince);
        runningSince = null;
      }
    }

    return {
      start() {
        if (started) return;
        started = true;
        unsubscribe = clock.subscribe(look);
        look();
      },
      elapsed() {
        look();
        return Math.round(counted + (runningSince === null ? 0 : Math.max(0, clock.now() - runningSince)));
      },
      stop() {
        if (!started) return;
        look();
        if (runningSince !== null) {
          counted += Math.max(0, clock.now() - runningSince);
          runningSince = null;
        }
        started = false;
        unsubscribe?.();
        unsubscribe = null;
      },
    };
  };
})(globalThis.WV);
