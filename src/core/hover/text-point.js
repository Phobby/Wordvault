'use strict';

// From a point on the screen to the word drawn there, for text that is in the DOM. The page is
// only read: the browser is asked which character is at the point, and the word is described
// by a Range over the text nodes as they are. Nothing is wrapped, split or inserted.

(function (WV) {
  if (!WV.words || WV.textPoint) return;

  /** Tolerance above and below a line, in px: glyph boxes are fractional, the pointer is not. */
  const SLACK = 1;
  /** A line longer than this is not a caption; scanning it letter by letter is not worth it. */
  const MAX_SCAN_CHARS = 600;

  // Sideways there is no tolerance: letters sit edge to edge, and a point on the border between
  // two of them has to belong to exactly one (the last letter of a word, not the space after).
  const inside = (rect, x, y) => x >= rect.left && x < rect.right && y >= rect.top - SLACK && y <= rect.bottom + SLACK;

  /** The text position the browser reports for a point: { node, offset }, or null. */
  function caretAt(doc, x, y) {
    try {
      if (typeof doc.caretPositionFromPoint === 'function') {
        const position = doc.caretPositionFromPoint(x, y);
        return position ? { node: position.offsetNode, offset: position.offset } : null;
      }
      if (typeof doc.caretRangeFromPoint === 'function') {
        const range = doc.caretRangeFromPoint(x, y);
        return range ? { node: range.startContainer, offset: range.startOffset } : null;
      }
    } catch {
      // Some documents refuse (a detached frame, for one); the scan below still works.
    }
    return null;
  }

  /** Whether the character at `offset` of a text node is drawn at the point. */
  function charIsAt(doc, node, offset, x, y) {
    if (offset < 0 || offset >= node.data.length) return false;
    const range = doc.createRange();
    range.setStart(node, offset);
    range.setEnd(node, offset + 1);
    return [...range.getClientRects()].some((rect) => inside(rect, x, y));
  }

  /**
   * The character under the point. A caret position is a gap between two characters, the one
   * closest to the point, so the character is the one before or the one after it. Where the
   * browser gives no caret (text that cannot be selected, in some browsers) the letters of the
   * line are measured one by one instead.
   */
  function charAt(doc, nodes, x, y) {
    const caret = caretAt(doc, x, y);
    const piece = caret ? nodes.indexOf(caret.node) : -1;
    if (piece >= 0) {
      for (const offset of [caret.offset, caret.offset - 1]) {
        if (charIsAt(doc, caret.node, offset, x, y)) return { piece, offset };
      }
    }
    let budget = MAX_SCAN_CHARS;
    for (let index = 0; index < nodes.length; index++) {
      const node = nodes[index];
      const whole = doc.createRange();
      whole.selectNodeContents(node);
      if (![...whole.getClientRects()].some((rect) => inside(rect, x, y))) continue;
      for (let offset = 0; offset < node.data.length && budget > 0; offset++, budget--) {
        if (charIsAt(doc, node, offset, x, y)) return { piece: index, offset };
      }
    }
    return null;
  }

  /**
   * The word at a point, among the text nodes of one line.
   *
   * @param {Object} query
   * @param {number} query.x          Viewport coordinates of the point.
   * @param {number} query.y
   * @param {Text[]} query.nodes      Text nodes of the line, in reading order. A word may run
   *                                  across several of them.
   * @param {string} [query.locale]   Language of the line, if known.
   * @param {Document} [query.doc]    The document the nodes are in.
   * @returns {{ text: string, start: number, end: number, range: Range, rect: DOMRect } | null}
   *          `start`/`end` are positions in the text of the whole line.
   */
  function wordAt({ x, y, nodes, locale = '', doc = document }) {
    if (!nodes || nodes.length === 0) return null;
    const hit = charAt(doc, nodes, x, y);
    if (!hit) return null;
    const line = WV.words.join(nodes.map((node) => node.data));
    const word = WV.words.at(line.text, line.indexOf(hit.piece, hit.offset), locale);
    if (!word) return null;
    const from = line.locate(word.start);
    const to = line.locate(word.end, true);
    if (!from || !to) return null;
    const range = doc.createRange();
    range.setStart(nodes[from.piece], from.offset);
    range.setEnd(nodes[to.piece], to.offset);
    return { text: word.text, start: word.start, end: word.end, range, rect: range.getBoundingClientRect() };
  }

  /** The text nodes under an element that have something in them, in document order. */
  function textNodes(root, doc = document) {
    const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
    const nodes = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.data.length > 0) nodes.push(node);
    }
    return nodes;
  }

  WV.textPoint = { wordAt, textNodes };
})(globalThis.WV);
