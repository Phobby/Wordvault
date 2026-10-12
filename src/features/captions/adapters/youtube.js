'use strict';

// YouTube's captions as a word source. The player draws them as ordinary text in the page, so
// the word under the pointer can be read from the DOM as it is.

(function (WV) {
  if (!WV.supported || !WV.captionSelectors) return;
  WV.captionAdapters = WV.captionAdapters || {};
  if (WV.captionAdapters.youtube) return;

  const selectors = WV.captionSelectors.youtube;

  /** The row of a caption the pointer is in: the element under it, or the row at that height. */
  function rowAt(captionWindow, target, y) {
    const direct = target.closest(selectors.line);
    if (direct && captionWindow.contains(direct)) return direct;
    const rows = [...captionWindow.querySelectorAll(selectors.line)];
    return (
      rows.find((row) => {
        const rect = row.getBoundingClientRect();
        return y >= rect.top && y <= rect.bottom;
      }) || (rows.length === 0 ? captionWindow : null)
    );
  }

  /** What a caption says, rows joined the way they are read. */
  function lineOf(captionWindow) {
    const rows = [...captionWindow.querySelectorAll(selectors.line)];
    const parts = rows.length > 0 ? rows.map((row) => row.textContent) : [captionWindow.textContent];
    return WV.words.tidy(parts.join(' '));
  }

  function create() {
    let watched = null; // the caption layer being observed
    let observer = null;

    // The player replaces a caption's elements whenever its text changes. Whoever holds a hit
    // from before is told, so that it lets go of a word that is no longer there.
    function watch(container) {
      if (container === watched) return;
      observer?.disconnect();
      watched = container;
      observer = new MutationObserver(() => source.emit({ type: 'gone' }));
      observer.observe(container, { childList: true, subtree: true, characterData: true });
    }

    const source = WV.wordSource.define({
      id: 'youtube',
      wordAt({ x, y, target }) {
        // Nearly every pointer move ends here: one `closest` and out.
        const captionWindow = target?.closest(selectors.window);
        if (!captionWindow) return null;
        const container = captionWindow.closest(selectors.container);
        if (!container) return null;
        watch(container);

        const row = rowAt(captionWindow, target, y);
        if (!row) return null;
        const lang = captionWindow.getAttribute('lang') || '';
        const word = WV.textPoint.wordAt({ x, y, nodes: WV.textPoint.textNodes(row), locale: lang });
        if (!word) return null;
        const line = lineOf(captionWindow);
        const rows = [...captionWindow.querySelectorAll(selectors.line)];
        return {
          text: word.text,
          line,
          rect: word.rect,
          area: captionWindow.getBoundingClientRect(),
          range: word.range,
          lang,
          key: `${line}\n${rows.indexOf(row)}:${word.start}`,
        };
      },
    });
    return source;
  }

  WV.captionAdapters.youtube = {
    id: 'youtube',
    matches: (location) => selectors.hosts.test(location.hostname),
    create,
  };
})(globalThis.WV);
