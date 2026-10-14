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
    // ("aria-hidden" is not among them: it hides text from screen readers, not from the eye, and
    // pages put it on visible labels and counters that have a spoken version elsewhere)
    '[translate="no"]', '.notranslate', '[hidden]', 'wordvault-ui',
  ].join(',');
  /**
   * ASSUMPTION: a font whose name says "icon" or "symbol" draws pictures from words ("search",
   * "menu"); translating that word would break the picture. Such text is left alone.
   */
  const ICON_FONT = /icon|symbol|glyph|fontawesome|material/i;
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

  /** Whether the page shows this text node at all, as text. */
  function shown(node, range) {
    const parent = node.parentElement;
    try {
      const style = getComputedStyle(parent);
      if (style.visibility !== 'visible' || ICON_FONT.test(style.fontFamily)) return false;
      range.selectNodeContents(node);
      return range.getClientRects().length > 0; // none: not laid out (display: none somewhere above, a closed <details>)
    } catch {
      return false;
    }
  }

  /**
   * The text nodes under a root, in document order, and those in the open shadow roots of its
   * elements (pages built of web components keep much of their text there). Skipped elements
   * are not entered at all.
   */
  function* textNodes(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => (node.nodeType === Node.ELEMENT_NODE && node.matches(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.nodeType === Node.TEXT_NODE) yield node;
      else if (node.shadowRoot) yield* textNodes(node.shadowRoot);
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
    let last = null; // { block, group }
    for (const node of textNodes(document.body)) {
      const parent = node.parentElement;
      const text = squeeze(node.nodeValue || '');
      if (!parent || !text || text.length > MAX_NODE_CHARS || !hasLetters(text)) continue; // (punctuation between two links stays as it is)
      if ((done && done(node)) || !shown(node, range)) continue;
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
    const walker = document.createTreeWalker(block || node.getRootNode(), NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
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
       * @returns {{ placed: [object, string[]][], unanswered: object[], stale: number }}  The groups
       *          that now show a translation (with its pieces), those that stayed as they were for
       *          want of a usable answer, and how many the page changed meanwhile (also left as they are).
       */
      apply(chunk, answers) {
        const placed = [];
        const unanswered = [];
        let stale = 0;
        chunk.forEach((group, index) => {
          const answer = answers?.[index];
          const pieces = Array.isArray(answer) ? answer : typeof answer === 'string' ? [answer] : null;
          if (!group.nodes.every((node, position) => node.isConnected && squeeze(node.nodeValue || '') === group.texts[position])) {
            stale += 1;
            return;
          }
          if (!pieces || pieces.length !== group.nodes.length || pieces.some((piece) => typeof piece !== 'string')) {
            unanswered.push(group);
            return;
          }
          group.nodes.forEach((node, position) => {
            const original = node.nodeValue;
            const translated = fitted(original, pieces[position]);
            changed.set(node, { original, translated });
            node.nodeValue = translated;
          });
          placed.push([group, pieces]);
        });
        return { placed, unanswered, stale };
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

  /** ASSUMPTION: runs of text one page keeps translations of; far more than the longest page that is translated. */
  const MEMORY_GROUPS = 20_000;

  /**
   * Translations already paid for, kept while the page is open (in this tab's memory only,
   * never stored): the same text in the same language is put in place again without a request,
   * after "Show original", after the card was closed and opened again, or when the page draws
   * text it had already shown anew.
   */
  function createMemory() {
    /** @type {Map<string, string[]>} */
    const known = new Map();
    const key = (lang, group) => `${lang}\u0001${group.texts.join('\u0002')}`;
    return {
      keep(lang, group, pieces) {
        if (known.size >= MEMORY_GROUPS) known.delete(known.keys().next().value);
        known.set(key(lang, group), pieces);
      },
      /** @returns {string[] | null} */
      recall: (lang, group) => known.get(key(lang, group)) || null,
      size: () => known.size,
    };
  }

  WV.pageTranslate = { collect, chunksOf, itemsOf, fitted, sizeOf, createLedger, createMemory };
})(globalThis.WV);
