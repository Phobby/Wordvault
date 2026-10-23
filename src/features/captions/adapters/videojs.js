'use strict';

// Captions of Video.js players as a word source. Brightcove's player is Video.js, and so are many
// course and company video sites (Cisco's training videos among them), so this adapter is not
// tied to a site: it applies wherever a Video.js player is on the page.
//
// Video.js draws a caption as ordinary text, but in a layer the pointer passes through
// (pointer-events: none), so the element under the pointer is the video, never the caption.
// The caption under the pointer is found by its box instead.

(function (WV) {
  if (!WV.supported || !WV.captionSelectors) return;
  WV.captionAdapters = WV.captionAdapters || {};
  if (WV.captionAdapters.videojs) return;

  const selectors = WV.captionSelectors.videojs;
  /** Tolerance around a caption's box, in px, like a line's in text-point.js. */
  const SLACK = 1;

  /** The text a caption shows: its rows are separated by line breaks in one text node. */
  const lineOf = (cue) => WV.words.tidy(cue.textContent || '');

  /** The box of what a caption draws: its text, not the full-width element around it. */
  function boxOf(cue) {
    const text = cue.firstElementChild || cue;
    return text.getBoundingClientRect();
  }

  const inside = (rect, x, y) =>
    rect.width > 0 && x >= rect.left - SLACK && x <= rect.right + SLACK && y >= rect.top - SLACK && y <= rect.bottom + SLACK;

  function create() {
    let watched = null; // the caption layer being observed
    let observer = null;

    // Video.js empties the layer and draws it again whenever the captions change (and when the
    // player is resized). Whoever holds a hit from before is told.
    function watch(display) {
      if (display === watched) return;
      observer?.disconnect();
      watched = display;
      observer = new MutationObserver(() => source.emit({ type: 'gone' }));
      observer.observe(display, { childList: true, subtree: true, characterData: true });
    }

    const source = WV.wordSource.define({
      id: 'videojs',
      wordAt({ x, y, target }) {
        // Nearly every pointer move ends here: one `closest` and out.
        const player = target?.closest(selectors.player);
        if (!player) return null;
        const display = player.querySelector(selectors.display);
        if (!display) return null;
        watch(display);

        const cues = [...display.querySelectorAll(selectors.cue)];
        const cue = cues.find((candidate) => inside(boxOf(candidate), x, y));
        if (!cue) return null;
        const doc = cue.ownerDocument || document;
        const lang = cue.getAttribute('lang') || '';
        const word = WV.textPoint.wordAt({ x, y, nodes: WV.textPoint.textNodes(cue, doc), locale: lang, doc });
        if (!word) return null;
        const line = lineOf(cue);
        return {
          text: word.text,
          line,
          rect: word.rect,
          area: boxOf(cue),
          range: word.range,
          lang,
          key: `${line}\n${cues.indexOf(cue)}:${word.start}`,
        };
      },
    });
    return source;
  }

  WV.captionAdapters.videojs = {
    id: 'videojs',
    matches: () => true,
    // Not every page with this script has a player: the pointer is only followed once one is there.
    needs: selectors.player,
    create,
  };
})(globalThis.WV);
