'use strict';

// Captions that a player draws as text in the page, as a word source: Netflix, Prime Video,
// Udemy, Video.js (Brightcove, Cisco's training videos) and the others in selectors.js (dom).
// One adapter for all of them: an entry only says which element is a caption.
//
// The caption under the pointer is found by its position, not by the element under the
// pointer: several players draw captions in a layer the pointer passes through
// (pointer-events: none), and others cover them with a transparent control layer.

(function (WV) {
  if (!WV.supported || !WV.captionSelectors) return;
  WV.captionAdapters = WV.captionAdapters || {};
  if (WV.captionAdapters.dom) return;

  const { players, sites } = WV.captionSelectors.dom;
  /** Tolerance around a box, in px, like a line's in text-point.js. */
  const SLACK = 1;
  /** How often a held word is checked for still being on screen, in ms. */
  const CHECK_MS = 250;

  const inside = (rect, x, y) =>
    rect.width > 0 && x >= rect.left - SLACK && x <= rect.right + SLACK && y >= rect.top - SLACK && y <= rect.bottom + SLACK;

  /** What is meant to apply here: the site's entries and those of every player. */
  function entriesFor(location) {
    return [...sites.filter((entry) => entry.hosts.test(location.hostname)), ...players];
  }

  /** The text nodes of a caption that are drawn on the row at height `y`. */
  function rowAt(nodes, y, doc) {
    return nodes.filter((node) => {
      const range = doc.createRange();
      range.selectNodeContents(node);
      return [...range.getClientRects()].some((rect) => y >= rect.top - SLACK && y <= rect.bottom + SLACK);
    });
  }

  /**
   * @param {Object[]} entries  Entries of selectors.js (dom) that apply on this page.
   */
  function create(entries = entriesFor(location)) {
    const selector = entries.map((entry) => entry.cue).join(', ');

    function find(x, y) {
      const cues = [...document.querySelectorAll(selector)];
      for (let index = 0; index < cues.length; index++) {
        const cue = cues[index];
        if (!inside(cue.getBoundingClientRect(), x, y)) continue;
        const doc = cue.ownerDocument || document;
        // Rows of one caption may be separate elements or split by <br>, so the word is looked
        // for among the text of the row under the pointer only; joined with the next row, the
        // last word of a row and the first of the next would read as one.
        const row = rowAt(WV.textPoint.textNodes(cue, doc), y, doc);
        if (row.length === 0) continue;
        const lang = cue.getAttribute('lang') || '';
        const word = WV.textPoint.wordAt({ x, y, nodes: row, locale: lang, doc });
        if (!word) continue;
        const line = WV.words.tidy(cue.innerText ?? cue.textContent);
        const rowText = row.map((node) => node.data).join('');
        return {
          text: word.text,
          line,
          rect: word.rect,
          area: cue.getBoundingClientRect(),
          range: word.range,
          lang,
          key: `${line}\n${index}:${rowText}:${word.start}`,
        };
      }
      return null;
    }

    // Players replace a caption's elements when its text changes, and some draw the same text
    // again (when their controls appear, or on resize). While the pointer rests on a word it is
    // checked now and then: the same word drawn again at that place keeps the hit; anything else
    // is reported, so that whoever holds the hit lets go of a word that is no longer there.
    let held = null; // { x, y, key, node, data }
    let timer = null;

    function hold(hit, x, y) {
      const node = hit.range.startContainer;
      held = { x, y, key: hit.key, node, data: node.data };
      timer ??= setInterval(check, CHECK_MS);
    }

    function release() {
      held = null;
      if (timer !== null) clearInterval(timer);
      timer = null;
    }

    function check() {
      if (!held) return release();
      if (held.node.isConnected && held.node.data === held.data) return;
      const again = find(held.x, held.y);
      if (again && again.key === held.key) {
        held.node = again.range.startContainer;
        held.data = held.node.data;
        return;
      }
      release();
      source.emit({ type: 'gone' });
    }

    const source = WV.wordSource.define({
      id: 'dom',
      wordAt({ x, y }) {
        const hit = find(x, y);
        if (hit) hold(hit, x, y);
        else release();
        return hit;
      },
    });
    return source;
  }

  WV.captionAdapters.dom = {
    id: 'dom',
    matches: () => true,
    // On a site with an entry of its own the pointer is followed from the start; elsewhere only
    // once one of the players is on the page.
    needs: (location) => (sites.some((entry) => entry.hosts.test(location.hostname)) ? null : players.map((entry) => entry.needs).join(', ')),
    create,
    entriesFor,
  };
})(globalThis.WV);
