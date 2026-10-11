'use strict';

// CSS for the UI that Wordvault adds to pages. It is kept in JS strings because it is only ever
// applied inside a shadow root (see createSurface in dom.js) and never as a page stylesheet.
//
// Sizes are in px on purpose: rem would follow the page's root font size.

(function (WV) {
  if (WV.styles) return;

  const base = `
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

    *, *::before, *::after { box-sizing: border-box; }
    [hidden] { display: none !important; }

    .wv-root {
      --wv-bg: #ffffff;
      --wv-fg: #15141a;
      --wv-muted: #5b5b66;
      --wv-border: rgba(21, 20, 26, 0.14);
      --wv-hover: rgba(21, 20, 26, 0.07);
      --wv-accent: #4f46e5;
      --wv-accent-fg: #ffffff;
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
        --wv-accent: #a5b4fc;
        --wv-accent-fg: #15141a;
        --wv-danger: #ff9a90;
        --wv-shadow: 0 10px 30px rgba(0, 0, 0, 0.5), 0 2px 6px rgba(0, 0, 0, 0.3);
        color-scheme: dark;
      }
    }

    .wv-icon {
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

    .wv-btn:focus-visible,
    .wv-btn-icon:focus-visible {
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
  `;

  const popup = `
    .wv-card {
      /* The host is a zero-sized box at the viewport origin, so left/top (set from popup.js)
         are viewport coordinates. */
      position: absolute;
      left: 0;
      top: 0;
      width: max-content;
      min-width: 220px;
      max-width: min(340px, calc(100vw - 16px));
      max-height: min(440px, calc(100vh - 16px));
      overflow: hidden auto;
      overscroll-behavior: contain;
      padding: 10px 14px 10px;
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

    .wv-langs {
      display: flex;
      align-items: center;
      gap: 6px;
      min-height: 22px;
      margin-top: 2px;
      font-size: 12px;
      color: var(--wv-muted);
    }
    .wv-lang-wrap {
      position: relative;
      display: inline-flex;
      align-items: center;
      min-width: 0;
      max-width: 60%;
      margin-left: -5px;
      padding: 2px 18px 2px 5px;
      border-radius: 6px;
    }
    .wv-lang-wrap:hover { background: var(--wv-hover); color: var(--wv-fg); }
    .wv-lang-wrap:has(.wv-lang:focus-visible) { outline: 2px solid var(--wv-accent); outline-offset: 1px; }
    .wv-lang-wrap::after {
      content: "";
      position: absolute;
      top: 50%;
      right: 6px;
      width: 5px;
      height: 5px;
      margin-top: -4px;
      border: solid currentColor;
      border-width: 0 1.5px 1.5px 0;
      transform: rotate(45deg);
      pointer-events: none;
    }
    .wv-lang-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .wv-lang {
      appearance: none;
      -webkit-appearance: none;
      -moz-appearance: none;
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      margin: 0;
      padding: 0;
      border: 0;
      opacity: 0;
      font: inherit;
      cursor: pointer;
    }
    .wv-lang option { background: var(--wv-bg); color: var(--wv-fg); }
    .wv-arrow { flex: none; }
    .wv-target { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

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
    .wv-body .wv-btn { margin-top: 10px; }

    .wv-foot { margin-top: 10px; font-size: 11px; color: var(--wv-muted); }
    .wv-foot:empty { display: none; }
  `;

  WV.styles = { base, popup };
})(globalThis.WV);
