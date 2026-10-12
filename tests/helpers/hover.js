// Loads the hover pipeline's classic scripts the way a browser does (one shared namespace), and
// a stand-in for the part of the DOM they read: text nodes laid out on a line, Ranges over
// them, and the browser's "which text position is at this point" call.

import { readFileSync } from 'node:fs';
import vm from 'node:vm';

/** @param {string[]} files  Paths under src/, in load order. */
export function loadScripts(files, globals = {}) {
  const sandbox = { WV: { supported: true }, ...globals };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const file of files) {
    vm.runInContext(readFileSync(new URL(`../../src/${file}`, import.meta.url), 'utf8'), sandbox, { filename: file });
  }
  return sandbox.WV;
}

export const CHAR_WIDTH = 10;
export const LINE_HEIGHT = 20;

const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });

/**
 * A line of text nodes, every character CHAR_WIDTH wide.
 * @param {(string | { text: string, gap?: number })[]} pieces  `gap`: empty space before the piece.
 * @param {{ top?: number, left?: number, rtl?: boolean }} [layout]  rtl: the first character is
 *        the rightmost one, as in Arabic or Hebrew.
 */
export function layoutLine(pieces, { top = 0, left = 0, rtl = false } = {}) {
  const nodes = [];
  const items = pieces.map((piece) => (typeof piece === 'string' ? { text: piece } : piece));
  const total = items.reduce((sum, item) => sum + (item.gap || 0) + item.text.length * CHAR_WIDTH, 0);
  let cursor = 0;
  for (const item of items) {
    cursor += item.gap || 0;
    const width = item.text.length * CHAR_WIDTH;
    const start = rtl ? left + total - cursor - width : left + cursor;
    nodes.push({ nodeType: 3, data: item.text, box: rect(start, top, width, LINE_HEIGHT), rtl });
    cursor += width;
  }
  return nodes;
}

/** Left edge of the character at `offset` of a node. */
function charLeft(node, offset) {
  return node.rtl ? node.box.right - (offset + 1) * CHAR_WIDTH : node.box.left + offset * CHAR_WIDTH;
}

/** Middle of a character: where a test puts the pointer to be on it. */
export function pointOn(node, offset) {
  return { x: charLeft(node, offset) + CHAR_WIDTH / 2, y: node.box.top + LINE_HEIGHT / 2 };
}

/**
 * @param {Object[]} nodes  All text nodes "on the page".
 * @param {{ caret?: 'position' | 'range' | 'none' | 'elsewhere' }} [options]  Which call the
 *        browser has for the text position at a point; 'elsewhere': it answers with a node
 *        that is not part of the line (as it does for text that cannot be selected).
 */
export function fakeDocument(nodes, { caret = 'position' } = {}) {
  const order = (node) => nodes.indexOf(node);

  function createRange() {
    let start = null;
    let end = null;
    const rects = () => {
      const result = [];
      for (let index = order(start.node); index <= order(end.node); index++) {
        const node = nodes[index];
        const from = node === start.node ? start.offset : 0;
        const to = node === end.node ? end.offset : node.data.length;
        if (to <= from) continue;
        const a = charLeft(node, from);
        const b = charLeft(node, to - 1);
        result.push(rect(Math.min(a, b), node.box.top, Math.abs(a - b) + CHAR_WIDTH, LINE_HEIGHT));
      }
      return result;
    };
    return {
      setStart: (node, offset) => (start = { node, offset }),
      setEnd: (node, offset) => (end = { node, offset }),
      selectNodeContents(node) {
        start = { node, offset: 0 };
        end = { node, offset: node.data.length };
      },
      getClientRects: rects,
      getBoundingClientRect() {
        const all = rects();
        if (all.length === 0) return rect(0, 0, 0, 0);
        const left = Math.min(...all.map((r) => r.left));
        const top = Math.min(...all.map((r) => r.top));
        return rect(left, top, Math.max(...all.map((r) => r.right)) - left, Math.max(...all.map((r) => r.bottom)) - top);
      },
      toString() {
        let text = '';
        for (let index = order(start.node); index <= order(end.node); index++) {
          const node = nodes[index];
          text += node.data.slice(node === start.node ? start.offset : 0, node === end.node ? end.offset : undefined);
        }
        return text;
      },
      get startContainer() {
        return start.node;
      },
      get startOffset() {
        return start.offset;
      },
    };
  }

  /** The gap between characters closest to the point, as browsers report it. */
  function caretAt(x, y) {
    if (caret === 'elsewhere') return { node: { nodeType: 1 }, offset: 0 };
    const node = nodes.find((n) => x >= n.box.left && x <= n.box.right && y >= n.box.top && y <= n.box.bottom);
    if (!node) return null;
    const along = node.rtl ? node.box.right - x : x - node.box.left;
    return { node, offset: Math.min(node.data.length, Math.round(along / CHAR_WIDTH)) };
  }

  const doc = { createRange };
  if (caret === 'position' || caret === 'elsewhere') {
    doc.caretPositionFromPoint = (x, y) => {
      const found = caretAt(x, y);
      return found && { offsetNode: found.node, offset: found.offset };
    };
  } else if (caret === 'range') {
    doc.caretRangeFromPoint = (x, y) => {
      const found = caretAt(x, y);
      return found && { startContainer: found.node, startOffset: found.offset };
    };
  }
  return doc;
}
