'use strict';

// "Translate this page with AI": finding the page's visible text, cutting it into chunks, and
// putting translations in its place. Put into a tab only when its user asks for it
// (features/page-translate/background.js).
//
// The page's structure is never touched. The only thing that changes is the text of text
// nodes that were already there (their `nodeValue`), and every one of them can be put back:
// no element is added, removed, moved or given an attribute. Text the user typed or can type
// (fields, text boxes, editable areas), hidden text and code are never read.

(function (WV) {
  if (WV.pageTranslate) return;

  /** Text inside these is never read. */
  const SKIP = [
    // what the user types into, or picks from
    'textarea', 'input', 'select', 'option', 'datalist', '[contenteditable]:not([contenteditable="false"])', '[role="textbox"]', '[role="searchbox"]', '[role="combobox"]',
    // code, and what is not text for reading
    'script', 'style', 'noscript', 'template', 'code', 'pre', 'kbd', 'samp', 'var', 'svg', 'math', 'canvas', 'iframe', 'object',
    // what the page says is not to be translated, what it hides, and Wordvault's own cards
    '[translate="no"]', '.notranslate', '[hidden]', '[aria-hidden="true"]', 'wordvault-ui',
  ].join(',');
  /** A text node longer than this is not prose (a data blob, a minified something). */
  const MAX_NODE_CHARS = 4000;
  /** Pieces of one sentence that are sent together; more than this is not one sentence. */
  const MAX_PIECES = 24;

  const squeeze = (text) => String(text).replace(/\s+/g, ' ').trim();
  const hasLetters = (text) => /\p{L}/u.test(text);

  /** The nearest ancestor that starts a line of its own: what is inside it reads as one run of text. */
  function blockOf(element, known) {
    const path = [];
    let current = element;
    let block = null;
    while (current) {
      if (known.has(current)) {
        block = known.get(current);
        break;
      }
      path.push(current);
      let display = 'block';
      try {
        display = getComputedStyle(current).display;
      } catch {
        // not an element with style
      }
      if (!display.startsWith('inline') && display !== 'contents') {
        block = current;
        break;
      }
      current = current.parentElement;
    }
    for (const step of path) known.set(step, block);
    return block;
  }

  /** Whether the page shows this text node at all. */
  function shown(node, range) {
    const parent = node.parentElement;
    try {
      if (getComputedStyle(parent).visibility !== 'visible') return false;
      range.selectNodeContents(node);
      return range.getClientRects().length > 0; // none: not laid out (display: none somewhere above, a closed <details>)
    } catch {
      return false;
    }
  }

  /**
   * The page's visible text, in reading order.
   * @param {(node: Text) => boolean} [done]  Nodes to leave out (they show a translation already).
   * @returns {{ nodes: Text[], texts: string[] }[]}  Groups: the text nodes of one run of text
   *          (one sentence or paragraph, cut by the page's formatting) and what each says.
   */
  function collect(done = null) {
    const groups = [];
    if (!document.body) return groups;
    const blocks = new WeakMap();
    const range = document.createRange();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let last = null; // { block, group }
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      const text = squeeze(node.nodeValue || '');
      if (!parent || !text || text.length > MAX_NODE_CHARS || !hasLetters(text)) continue; // (punctuation between two links stays as it is)
      if (parent.closest(SKIP) || (done && done(node)) || !shown(node, range)) continue;
      const block = blockOf(parent, blocks);
      if (last && last.block === block && last.group.nodes.length < MAX_PIECES && last.end === previousText(node, block)) {
        last.group.nodes.push(node);
        last.group.texts.push(text);
      } else {
        last = { block, group: { nodes: [node], texts: [text] } };
        groups.push(last.group);
      }
      last.end = node;
    }
    return groups;
  }

  /**
   * The text node with letters that comes before this one inside the same block, or null. A
   * run of text ends where another block (or something skipped, like a field) stands in it.
   */
  function previousText(node, block) {
    const walker = document.createTreeWalker(block || document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    walker.currentNode = node;
    for (let before = walker.previousNode(); before; before = walker.previousNode()) {
      if (before.nodeType === Node.TEXT_NODE) {
        if (hasLetters(before.nodeValue || '')) return before;
        continue;
      }
      // an element between the two: fine if this node is inside it or it is part of the line
      if (before.contains(node)) continue;
      let display = 'block';
      try {
        display = getComputedStyle(before).display;
      } catch {
        // stays 'block'
      }
      if (!display.startsWith('inline') && display !== 'contents') return null;
      if (before.localName === 'br') return null;
    }
    return null;
  }

  const sizeOf = (group) => group.texts.reduce((sum, text) => sum + text.length, 0);

  /**
   * Cuts groups into chunks for one request each.
   * @param {{ texts: string[] }[]} groups
   * @param {{ chunkChars: number, chunkItems: number, maxChars: number }} limits
   * @returns {{ chunks: object[][], chars: number, total: number, left: number }}  chars: what
   *          is in the chunks; total: what the page has; left: groups beyond the limit.
   */
  function chunksOf(groups, { chunkChars, chunkItems, maxChars }) {
    const chunks = [];
    let current = [];
    let size = 0;
    let chars = 0;
    let total = 0;
    let left = 0;
    for (const group of groups) {
      const length = sizeOf(group);
      total += length;
      if (chars + length > maxChars) {
        left += 1;
        continue;
      }
      if (current.length > 0 && (size + length > chunkChars || current.length >= chunkItems)) {
        chunks.push(current);
        current = [];
        size = 0;
      }
      current.push(group);
      size += length;
      chars += length;
    }
    if (current.length > 0) chunks.push(current);
    return { chunks, chars, total, left };
  }

  /** What a chunk looks like on its way to the model: one item per group. */
  const itemsOf = (chunk) => chunk.map((group) => (group.texts.length === 1 ? group.texts[0] : group.texts));

  /** A translation with the white space the original had around it (the model's answer has none). */
  function fitted(original, translated) {
    const lead = /^\s*/.exec(original)[0];
    const trail = /\s*$/.exec(original)[0];
    return `${lead}${String(translated).replace(/\s+/g, ' ').trim()}${original.trim() ? trail : ''}`;
  }

  /**
   * Keeps what was changed, so that all of it can be put back.
   * @returns {{ apply, restore, showAgain, has, count, clear }}
   */
  function createLedger() {
    /** @type {Map<Text, { original: string, translated: string }>} */
    const changed = new Map();
    return {
      /**
       * Puts the translations of a chunk in place.
       * @param {{ nodes: Text[] }[]} chunk
       * @param {(string | string[] | null)[]} answers  As ai/page-translate.js returns them.
       * @returns {number} Groups that stayed as they were (no usable answer, or the page changed them meanwhile).
       */
      apply(chunk, answers) {
        let skipped = 0;
        chunk.forEach((group, index) => {
          const answer = answers?.[index];
          const pieces = Array.isArray(answer) ? answer : typeof answer === 'string' ? [answer] : null;
          const untouched = group.nodes.every((node, position) => node.isConnected && squeeze(node.nodeValue || '') === group.texts[position]);
          if (!pieces || pieces.length !== group.nodes.length || !untouched || pieces.some((piece) => typeof piece !== 'string')) {
            skipped += 1;
            return;
          }
          group.nodes.forEach((node, position) => {
            const original = node.nodeValue;
            const translated = fitted(original, pieces[position]);
            changed.set(node, { original, translated });
            node.nodeValue = translated;
          });
        });
        return skipped;
      },
      /** Back to the original. A node the page has changed since is left as the page has it. */
      restore() {
        for (const [node, { original, translated }] of changed) if (node.nodeValue === translated) node.nodeValue = original;
      },
      /** The translation again, from memory: nothing is sent. */
      showAgain() {
        for (const [node, { original, translated }] of changed) if (node.nodeValue === original) node.nodeValue = translated;
      },
      /** Whether a node shows our translation right now. */
      has: (node) => changed.has(node) && node.nodeValue === changed.get(node).translated,
      count: () => changed.size,
      clear: () => changed.clear(),
    };
  }

  WV.pageTranslate = { collect, chunksOf, itemsOf, fitted, sizeOf, createLedger };
})(globalThis.WV);
