'use strict';

// CSS shared by the UI that Wordvault adds to pages and by the extension's own pages. It lives
// in JS strings because inside pages it is only ever applied within a shadow root (see
// createSurface in dom.js), never as a page stylesheet. The extension pages adopt `tokens` and
// `controls` (see WV.adoptStyles) so the same controls look the same everywhere.
//
// Sizes are in px on purpose: rem would follow the page's root font size.

(function (WV) {
  if (WV.styles) return;

  /** Shadow host reset. Only for surfaces injected into web pages. */
  const host = `
    :host {
      /* !important declarations of a shadow tree beat the page's own rules, even its
         !important ones, so nothing the page does can restyle, move or hide the host. */
      all: initial !important;
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      width: 0 !important;
      height: 0 !important;
      display: block !important;
      z-index: 2147483647 !important;
      /* "all" does not cover these two. */
      direction: ltr !important;
      unicode-bidi: isolate !important;
    }
  `;

  /** Colours and typography, on the element with class "wv-root". */
  const tokens = `
    *, *::before, *::after { box-sizing: border-box; }
    [hidden] { display: none !important; }

    .wv-root {
      --wv-bg: #ffffff;
      --wv-fg: #15141a;
      --wv-muted: #5b5b66;
      --wv-border: rgba(21, 20, 26, 0.14);
      --wv-hover: rgba(21, 20, 26, 0.07);
      --wv-tint: #eef0ff;
      --wv-accent: #4f46e5;
      --wv-accent-fg: #ffffff;
      --wv-ok: #15803d;
      --wv-danger: #b42318;
      --wv-shadow: 0 10px 30px rgba(0, 0, 0, 0.2), 0 2px 6px rgba(0, 0, 0, 0.1);
      color-scheme: light;
      font: 400 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      color: var(--wv-fg);
      text-align: start;
      -webkit-text-size-adjust: 100%;
      text-size-adjust: 100%;
    }

    @media (prefers-color-scheme: dark) {
      .wv-root {
        --wv-bg: #23222b;
        --wv-fg: #fbfbfe;
        --wv-muted: #a9a9b8;
        --wv-border: rgba(251, 251, 254, 0.16);
        --wv-hover: rgba(251, 251, 254, 0.1);
        --wv-tint: rgba(165, 180, 252, 0.14);
        --wv-accent: #a5b4fc;
        --wv-accent-fg: #15141a;
        --wv-ok: #86efac;
        --wv-danger: #ff9a90;
        --wv-shadow: 0 10px 30px rgba(0, 0, 0, 0.5), 0 2px 6px rgba(0, 0, 0, 0.3);
        color-scheme: dark;
      }
    }
  `;

  /** Buttons, links, the spinner and the searchable language list. */
  const controls = `
    .wv-icon {
      flex: none;
      width: 18px;
      height: 18px;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .wv-btn-icon {
      flex: none;
      display: inline-grid;
      place-items: center;
      width: 28px;
      height: 28px;
      margin: 0;
      padding: 0;
      border: 0;
      border-radius: 8px;
      background: transparent;
      color: var(--wv-muted);
      cursor: pointer;
    }
    .wv-btn-icon:hover { background: var(--wv-hover); color: var(--wv-fg); }

    .wv-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      margin: 0;
      padding: 5px 10px;
      border: 1px solid var(--wv-border);
      border-radius: 8px;
      background: transparent;
      color: var(--wv-fg);
      font: inherit;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }
    .wv-btn:hover { background: var(--wv-hover); }
    .wv-btn:disabled { opacity: 0.55; cursor: default; }
    .wv-btn-primary { border-color: transparent; background: var(--wv-accent); color: var(--wv-accent-fg); }
    .wv-btn-primary:hover { background: var(--wv-accent); filter: brightness(1.08); }
    .wv-btn-sm { padding: 3px 8px; font-size: 12px; }
    .wv-btn-saved { border-color: currentColor; color: var(--wv-ok); }
    .wv-status { font-size: 12px; font-weight: 600; color: var(--wv-ok); animation: wv-fade 0.2s ease-out; }
    .wv-status-error { color: var(--wv-danger); }
    @keyframes wv-fade { from { opacity: 0; } }

    .wv-link {
      margin: 0;
      padding: 0;
      border: 0;
      background: none;
      color: var(--wv-accent);
      font: inherit;
      text-decoration: underline;
      cursor: pointer;
    }

    .wv-btn:focus-visible,
    .wv-btn-icon:focus-visible,
    .wv-link:focus-visible,
    .wv-chip:focus-visible,
    .wv-ll-item:focus-visible {
      outline: 2px solid var(--wv-accent);
      outline-offset: 1px;
    }

    .wv-spinner {
      flex: none;
      width: 14px;
      height: 14px;
      border: 2px solid var(--wv-border);
      border-top-color: var(--wv-accent);
      border-radius: 50%;
      animation: wv-spin 0.7s linear infinite;
    }
    @keyframes wv-spin { to { transform: rotate(360deg); } }

    /* A language name that opens the language list when clicked. */
    .wv-chip {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      min-width: 0;
      max-width: 100%;
      margin: 0;
      padding: 3px 6px;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: inherit;
      font: inherit;
      cursor: pointer;
    }
    .wv-chip:hover { background: var(--wv-hover); color: var(--wv-fg); }
    .wv-chip-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .wv-chip::after {
      content: "";
      flex: none;
      width: 5px;
      height: 5px;
      margin: -3px 2px 0 1px;
      border: solid currentColor;
      border-width: 0 1.5px 1.5px 0;
      transform: rotate(45deg);
    }

    /* Searchable language list (language-list.js). */
    .wv-ll { display: flex; flex-direction: column; gap: 6px; min-height: 0; }
    .wv-ll-search {
      width: 100%;
      margin: 0;
      padding: 6px 8px;
      border: 1px solid var(--wv-border);
      border-radius: 8px;
      background: var(--wv-bg);
      color: var(--wv-fg);
      font: inherit;
      font-size: 13px;
    }
    .wv-ll-search:focus { outline: 2px solid var(--wv-accent); outline-offset: -1px; border-color: transparent; }
    .wv-ll-list {
      position: relative;
      max-height: 216px;
      overflow-y: auto;
      overscroll-behavior: contain;
    }
    .wv-ll-item {
      display: flex;
      align-items: baseline;
      gap: 8px;
      width: 100%;
      margin: 0;
      padding: 5px 8px;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: var(--wv-fg);
      font: inherit;
      font-size: 13px;
      text-align: start;
      cursor: pointer;
    }
    .wv-ll-item:hover, .wv-ll-item.wv-ll-active { background: var(--wv-hover); }
    .wv-ll-pinned { position: sticky; top: 0; z-index: 1; background: var(--wv-bg); }
    .wv-ll-pinned:hover, .wv-ll-pinned.wv-ll-active {
      background: linear-gradient(var(--wv-hover), var(--wv-hover)), var(--wv-bg);
    }
    .wv-ll-item[aria-selected="true"] { color: var(--wv-accent); font-weight: 600; }
    .wv-ll-native { color: var(--wv-muted); font-size: 12px; font-weight: 400; }
    .wv-ll-empty { padding: 6px 8px; font-size: 13px; color: var(--wv-muted); }
  `;

  /** The translation popup shown next to selected text. */
  const popup = `
    .wv-card {
      /* The host is a zero-sized box at the viewport origin, so left/top (set from popup.js)
         are viewport coordinates. */
      position: absolute;
      left: 0;
      top: 0;
      width: min(300px, calc(100vw - 16px));
      max-height: min(460px, calc(100vh - 16px));
      overflow: hidden auto;
      overscroll-behavior: contain;
      padding: 10px 14px;
      border: 1px solid var(--wv-border);
      border-radius: 12px;
      background: var(--wv-bg);
      box-shadow: var(--wv-shadow);
      animation: wv-pop 0.12s ease-out;
    }
    @keyframes wv-pop { from { opacity: 0; transform: translateY(4px); } }
    @media (prefers-reduced-motion: reduce) { .wv-card { animation: none; } }

    .wv-head {
      display: flex;
      align-items: flex-start;
      gap: 2px;
      margin-right: -8px;
    }
    .wv-word {
      flex: 1 1 auto;
      min-width: 0;
      margin-right: 6px;
      padding-top: 3px;
      font-size: 16px;
      font-weight: 650;
      line-height: 1.35;
      overflow-wrap: anywhere;
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 3;
      line-clamp: 3;
      overflow: hidden;
    }
    .wv-sheet-title { flex: 1 1 auto; min-width: 0; padding-top: 4px; font-size: 14px; font-weight: 650; }
    .wv-sheet .wv-head { margin-left: -8px; margin-bottom: 8px; }

    .wv-langs {
      display: flex;
      align-items: center;
      gap: 2px;
      margin: 3px 0 0 -6px;
      font-size: 12px;
      color: var(--wv-muted);
    }
    .wv-langs .wv-chip { flex: 0 1 auto; }
    .wv-arrow { flex: none; }

    .wv-check {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: 4px;
      font-size: 12px;
      color: var(--wv-muted);
      cursor: pointer;
    }
    .wv-check input { flex: none; width: 14px; height: 14px; margin: 0; accent-color: var(--wv-accent); }

    .wv-setup {
      margin-top: 8px;
      padding: 8px 10px;
      border-radius: 8px;
      background: var(--wv-tint);
      font-size: 12.5px;
    }
    .wv-setup-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }

    .wv-body {
      margin-top: 8px;
      padding-top: 10px;
      border-top: 1px solid var(--wv-border);
    }
    .wv-translation {
      font-size: 18px;
      font-weight: 500;
      line-height: 1.35;
      overflow-wrap: anywhere;
    }
    .wv-translation.wv-long { font-size: 14px; font-weight: 400; line-height: 1.45; }
    .wv-alts {
      margin-top: 6px;
      font-size: 13px;
      color: var(--wv-muted);
      overflow-wrap: anywhere;
    }
    .wv-alts-label { font-weight: 600; }
    .wv-note { font-size: 12.5px; color: var(--wv-muted); }
    .wv-translation ~ .wv-note { margin-top: 8px; }

    .wv-loading {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 24px;
      font-size: 13px;
      color: var(--wv-muted);
    }
    .wv-error { font-size: 13px; color: var(--wv-danger); overflow-wrap: anywhere; }
    .wv-error-detail {
      margin-top: 4px;
      font-size: 12px;
      color: var(--wv-muted);
      overflow-wrap: anywhere;
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 3;
      line-clamp: 3;
      overflow: hidden;
    }

    .wv-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 10px; }
    .wv-actions:empty { display: none; }

    .wv-foot { margin-top: 10px; font-size: 11px; color: var(--wv-muted); }
    .wv-foot:empty { display: none; }
  `;

  WV.styles = { host, tokens, controls, popup };
})(globalThis.WV);
