'use strict';

// The main text of the page, for "Summarise this page". Put into the page only when the user
// asks for a summary, together with Mozilla's Readability (vendor/readability, unmodified),
// which finds the article among the menus, advertisements and side columns.
//
// The page itself is never changed: all of this works on a copy of the document. Before the
// copy is searched, everything that is not the page's own visible text is taken out of it:
// what the user typed or could type (fields, text boxes, editable areas), what is hidden, and
// code. None of that can end up in what is sent to the AI provider.

(function (WV) {
  if (WV.pageText) return;

  /** Never part of the text, whatever is in them. */
  const NEVER = new Set([
    // what the user types into, or picks from: their content is theirs, not the page's
    'input', 'textarea', 'select', 'option', 'optgroup', 'datalist', 'button', 'output',
    // code and other documents
    'script', 'style', 'noscript', 'template', 'iframe', 'frame', 'object', 'embed', 'canvas', 'svg',
    // Wordvault's own popup and cards
    'wordvault-ui',
  ]);
  /** Roles of things the user writes in. */
  const TYPING_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton']);
  /** Around the main text rather than part of it. Only used when Readability finds no article. */
  const AROUND = new Set(['nav', 'aside', 'header', 'footer', 'menu', 'form', 'dialog']);
  const AROUND_ROLES = new Set(['navigation', 'banner', 'contentinfo', 'complementary', 'search', 'dialog', 'alertdialog', 'menu', 'menubar', 'toolbar']);
  /** An empty line stands between these and what is next to them ... */
  const BLOCKS = new Set(['p', 'div', 'section', 'article', 'main', 'header', 'footer', 'aside', 'nav', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'dl', 'blockquote', 'pre', 'table', 'figure', 'figcaption', 'hr', 'address', 'details', 'form', 'fieldset']);
  /** ... and a line break between these. */
  const LINES = new Set(['li', 'tr', 'dt', 'dd', 'summary', 'caption']);
  /** Less than this is not an article (a login page, a player, an empty page). */
  const MIN_CHARS = 250;

  const ELEMENT = 1;
  const TEXT = 3;

  const attribute = (element, name) => (typeof element.getAttribute === 'function' ? element.getAttribute(name) : null);
  const role = (element) => String(attribute(element, 'role') || '').trim().toLowerCase();

  /** Whether an element is left out because of what it is (not because of how the page shows it). */
  function leftOut(element) {
    if (NEVER.has(element.localName)) return true;
    if (attribute(element, 'hidden') != null) return true;
    if (attribute(element, 'aria-hidden') === 'true') return true;
    const editable = attribute(element, 'contenteditable');
    if (editable != null && editable !== 'false') return true;
    return TYPING_ROLES.has(role(element));
  }

  /** Whether the page shows nothing of an element (of the real one, not of its copy). */
  function hiddenOnPage(element) {
    try {
      const style = getComputedStyle(element);
      return style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.contentVisibility === 'hidden';
    } catch {
      return false;
    }
  }

  /**
   * Takes out of a copy what must not be read.
   * @param {Node} copy  Root of the copy; changed in place.
   * @param {Node | null} [original]  The same node in the real document: the copy has no
   *        layout, so whether something is shown is asked of the original.
   * @param {((element: Element) => boolean) | null} [isHidden]
   * @param {(element: Element) => boolean} [alsoOut]  Further elements to take out.
   */
  function strip(copy, original = null, isHidden = null, alsoOut = null) {
    const stack = [[copy, original]];
    while (stack.length > 0) {
      const [node, twin] = stack.pop();
      const children = Array.from(node.childNodes || []);
      // The copy was made a moment ago, so both have the same children in the same order.
      const twins = twin && twin.childNodes && twin.childNodes.length === children.length ? Array.from(twin.childNodes) : null;
      children.forEach((child, index) => {
        if (child.nodeType === TEXT) return;
        const real = twins ? twins[index] : null;
        const out = child.nodeType !== ELEMENT || leftOut(child) || (alsoOut && alsoOut(child)) || (isHidden && real && real.nodeType === ELEMENT && isHidden(real));
        if (out) node.removeChild(child); // comments and the like go too
        else stack.push([child, real]);
      });
    }
    return copy;
  }

  /** The text of a tree, with an empty line between paragraphs and one line per list item or table row. */
  function textOf(root) {
    let out = '';
    /** Line breaks owed before the next piece of text: 0, 1 or 2. Several in a row count once. */
    let owed = 0;
    const stack = [root];
    while (stack.length > 0) {
      const node = stack.pop();
      if (typeof node === 'number') {
        owed = Math.max(owed, node);
        continue;
      }
      if (node.nodeType === TEXT) {
        const text = String(node.textContent || '').replace(/\s+/g, ' ');
        if (!text.trim()) {
          if (out && !owed && !out.endsWith(' ')) out += ' ';
          continue;
        }
        if (owed && out) out = `${out.trimEnd()}${'\n'.repeat(owed)}${text.trimStart()}`;
        else out += out ? text : text.trimStart();
        owed = 0;
        continue;
      }
      if (node.nodeType !== ELEMENT && node !== root) continue;
      const name = node.localName;
      if (name === 'br') {
        owed = Math.max(owed, 1);
        continue;
      }
      const gap = BLOCKS.has(name) ? 2 : LINES.has(name) ? 1 : 0;
      if (gap) stack.push(gap);
      const children = Array.from(node.childNodes || []);
      for (let index = children.length - 1; index >= 0; index -= 1) stack.push(children[index]);
      // (cells of a row are set apart by a space)
      if (gap) stack.push(gap);
      else if ((name === 'td' || name === 'th') && out && !out.endsWith(' ') && !owed) out += ' ';
    }
    return out.replace(/[ \t\u00a0]+/g, ' ').replace(/ ?\n ?/g, '\n').trim();
  }

  /** Every element under a root (and the root) for which `test` holds. */
  function find(root, test) {
    const found = [];
    const stack = [root];
    while (stack.length > 0) {
      const node = stack.pop();
      if (node.nodeType === ELEMENT && test(node)) found.push(node);
      for (const child of Array.from(node.childNodes || [])) if (child.nodeType === ELEMENT) stack.push(child);
    }
    return found;
  }

  /**
   * Without Readability's answer: the page's own "main" part if it names one, otherwise the
   * body, without what is marked as navigation, header, footer or side column.
   * @param {Node} body  A stripped copy; changed in place.
   */
  function plainText(body) {
    strip(body, null, null, (element) => AROUND.has(element.localName) || AROUND_ROLES.has(role(element)));
    const mains = find(body, (element) => element.localName === 'main' || element.localName === 'article' || role(element) === 'main').map(textOf);
    const longest = mains.sort((a, b) => b.length - a.length)[0] || '';
    return longest.length >= MIN_CHARS ? longest : textOf(body);
  }

  /** Readability's article as text, or '' if it finds none. */
  function articleText(copy) {
    if (typeof globalThis.Readability !== 'function') return '';
    try {
      // (the serializer hands the element itself back, so that the text is taken paragraph by paragraph)
      const article = new globalThis.Readability(copy, { serializer: (element) => element }).parse();
      return article && article.content ? textOf(article.content) : '';
    } catch {
      return ''; // a page it cannot make sense of
    }
  }

  /**
   * The main text of this page.
   * @returns {{ text: string, title: string, lang: string, from: 'article' | 'page' | 'none' }}
   *          from: Readability's article, or the plain way; 'none': there is too little text.
   */
  function extract() {
    const prepared = () => strip(document.cloneNode(true), document, hiddenOnPage);
    const title = String(document.title || '').replace(/\s+/g, ' ').trim();
    const lang = String(document.documentElement?.lang || '');
    let text = articleText(prepared()); // Readability changes what it is given: each way gets its own copy
    let from = 'article';
    if (text.length < MIN_CHARS) {
      const copy = prepared();
      text = copy.body ? plainText(copy.body) : '';
      from = 'page';
    }
    return text.length >= MIN_CHARS ? { text, title, lang, from } : { text: '', title, lang, from: 'none' };
  }

  WV.pageText = { extract, strip, textOf, plainText, articleText, leftOut, MIN_CHARS };
})(globalThis.WV);
