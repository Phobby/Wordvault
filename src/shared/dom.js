'use strict';

// UI helpers shared by the content scripts and the extension's own pages (toolbar popup,
// options). Content scripts are classic scripts, so these files cannot import each other; they
// share this namespace object instead. In a web page it lives on the global of the extension's
// isolated world, where the page cannot see or touch it.
globalThis.WV = globalThis.WV || {};

(function (WV) {
  if (WV.createSurface) return;

  const XHTML_NS = 'http://www.w3.org/1999/xhtml';
  const SVG_NS = 'http://www.w3.org/2000/svg';

  /** False for SVG/XML documents, where an HTML shadow host cannot be created. */
  WV.supported = document.documentElement?.namespaceURI === XHTML_NS;

  /** Localized string from _locales. */
  WV.t = function t(key, substitutions) {
    try {
      return chrome.i18n.getMessage(key, substitutions) || key;
    } catch {
      return key; // extension was reloaded underneath this page
    }
  };

  /**
   * Tiny element builder. All Wordvault UI is built with DOM APIs and textContent, never with
   * innerHTML, so text coming from pages or translation services can never become markup.
   */
  WV.h = function h(tag, props, ...children) {
    const element = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (value == null || value === false) continue;
      if (key === 'class') element.className = value;
      else if (key === 'text') element.textContent = value;
      else if (key.startsWith('on')) element.addEventListener(key.slice(2), value);
      else element.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat()) {
      if (child != null && child !== false) element.append(child);
    }
    return element;
  };

  /** 24x24 single-path icon. */
  WV.icon = function icon(pathData) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'wv-icon');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', pathData);
    svg.append(path);
    return svg;
  };

  /**
   * Sends a request to the background script and resolves with its data.
   * Rejects with `{ code, detail }` (see lib/errors.js for the codes).
   */
  WV.send = async function send(type, payload) {
    let response;
    try {
      response = await chrome.runtime.sendMessage({ type, payload });
    } catch (error) {
      // After the extension is updated or reloaded, content scripts in already open tabs lose
      // their connection to it until the tab is reloaded.
      const code = chrome.runtime?.id ? 'internal' : 'context_invalidated';
      throw { code, detail: String(error?.message || error) };
    }
    if (!response) throw { code: 'internal', detail: 'empty response' };
    if (!response.ok) throw response.error;
    return response.data;
  };

  /** Applies CSS to the current document without a <style> element. For extension pages. */
  WV.adoptStyles = function adoptStyles(css) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  };

  /** Everything outside an open modal <dialog> is inert, so UI for text inside one has to live in it. */
  function parentFor(node) {
    let element = node && (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement);
    while (element) {
      try {
        if (element.localName === 'dialog' && element.matches(':modal')) return element;
      } catch {
        break; // :modal is not supported
      }
      element = element.parentElement || element.getRootNode()?.host || null;
    }
    return document.documentElement;
  }

  /**
   * Creates an isolated UI surface: a host element with a closed shadow root.
   *
   * Isolation works in both directions. Page CSS cannot reach into the shadow tree, and the
   * `:host` rule in styles.js resets everything the page could set on (or inherit into) the host.
   * The extension's own CSS only exists inside the shadow root, so it cannot leak into the page.
   *
   * @param {string} css Styles for this surface, appended to the shared base styles.
   */
  WV.createSurface = function createSurface(css) {
    const host = document.createElement('wordvault-ui');
    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = WV.styles.host + WV.styles.tokens + WV.styles.controls + css;
    const root = WV.h('div', { class: 'wv-root' });
    shadow.append(style, root);

    // Keys pressed inside the surface (typing in a search box, for instance) are ours. Without
    // this they would bubble into the page and trigger its keyboard shortcuts.
    for (const type of ['keydown', 'keypress', 'keyup']) {
      root.addEventListener(type, (event) => event.stopPropagation());
    }

    // The top layer (Popover API) puts the surface above every z-index, above fullscreen video
    // and outside the reach of `transform`/`filter` on page ancestors, which would otherwise
    // break `position: fixed`. Browsers without it fall back to a plain fixed-position host.
    const canPopover = typeof host.showPopover === 'function';
    if (canPopover) host.setAttribute('popover', 'manual');

    function ensureStyles() {
      // A page CSP without 'unsafe-inline' can block <style> elements. Constructable stylesheets
      // are not subject to CSP, so they are the fallback.
      if (style.sheet || shadow.adoptedStyleSheets?.length) return;
      try {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(style.textContent);
        shadow.adoptedStyleSheets = [sheet];
      } catch {
        // Nothing else to try; the UI still works, just unstyled.
      }
    }

    return {
      host,
      root,
      /** Attaches the surface to the page (again), on top of everything currently shown. */
      mount(anchorNode) {
        host.remove(); // re-inserting is what moves a popover to the top of the top layer
        parentFor(anchorNode).append(host);
        ensureStyles();
        if (canPopover) {
          try {
            host.showPopover();
          } catch {
            // Already open or not allowed here; the fixed-position fallback still applies.
          }
        }
      },
      unmount() {
        host.remove();
      },
      /** Whether a DOM event started inside this surface. */
      containsEvent(event) {
        return event.composedPath().includes(host);
      },
    };
  };
})(globalThis.WV);
