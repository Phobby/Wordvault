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
    .wv-status-muted { font-weight: 400; color: var(--wv-muted); }
    .wv-busy { animation: wv-pulse 0.9s ease-in-out infinite; }
    @keyframes wv-pulse { 50% { opacity: 0.35; } }
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

    .wv-foot { display: flex; flex-wrap: wrap; gap: 2px 10px; margin-top: 10px; font-size: 11px; color: var(--wv-muted); }
    .wv-foot a { color: inherit; }
    .wv-foot:empty { display: none; }

    /* "Explain with AI": under the result, apart from it. */
    .wv-ai { margin-top: 10px; padding-top: 8px; border-top: 1px dashed var(--wv-border); font-size: 12.5px; }
    .wv-ai-ask { display: inline-flex; align-items: center; gap: 4px; text-decoration: none; font-size: 12.5px; }
    .wv-ai-ask:hover { text-decoration: underline; }
    .wv-ai-ask .wv-icon { width: 14px; height: 14px; }
    .wv-ai-label { font-size: 11px; font-weight: 650; letter-spacing: 0.02em; color: var(--wv-muted); text-transform: uppercase; }
    .wv-ai-text { margin-top: 4px; max-height: min(220px, 36vh); overflow: hidden auto; overscroll-behavior: contain; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 13px; line-height: 1.5; }
    .wv-ai-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 8px; }
    .wv-ai-row:empty { display: none; }
    .wv-ai-note { margin-top: 6px; color: var(--wv-muted); }
    .wv-ai-note.wv-error { color: var(--wv-danger); }
    .wv-ai-note:first-child { margin-top: 0; }
    .wv-standalone .wv-ai-text { max-height: none; }

    /* A passage (a selected sentence or paragraph): wider, the selection as small text cut
       after three lines, the translation with its line breaks and a scroll bar of its own. */
    .wv-card.wv-passage { width: min(380px, calc(100vw - 16px)); max-height: min(540px, calc(100vh - 16px)); }
    .wv-passage .wv-word { font-size: 13px; font-weight: 400; line-height: 1.45; color: var(--wv-muted); white-space: pre-line; }
    .wv-passage .wv-word.wv-expanded { display: block; max-height: min(160px, 30vh); overflow: hidden auto; overscroll-behavior: contain; }
    .wv-more { display: block; margin-top: 2px; font-size: 12px; }
    .wv-passage-text { max-height: min(240px, 40vh); overflow: hidden auto; overscroll-behavior: contain; white-space: pre-line; }
    .wv-passage-text + .wv-loading, .wv-partial { margin-top: 8px; }
    .wv-btn .wv-icon { width: 14px; height: 14px; vertical-align: -2px; }
    .wv-offscreen { position: fixed; left: -9999px; top: 0; width: 1px; height: 1px; opacity: 0; }
    /* Alone in a window of its own: it is the window. */
    .wv-card.wv-standalone {
      position: fixed;
      inset: 0;
      width: 100vw;
      height: 100vh;
      max-height: none;
      border: 0;
      border-radius: 0;
      box-shadow: none;
      animation: none;
    }
    .wv-standalone .wv-passage-text { max-height: none; }
  `;

  /** The quiz: as a card in the top right corner of a page (.wv-quiz-floating), or filling the
   *  toolbar popup or the quiz window. */
  const quiz = `
    .wv-quiz {
      position: relative;
      box-sizing: border-box;
      padding: 8px 14px 10px;
      background: var(--wv-bg);
    }
    .wv-quiz-floating {
      /* The host sits in the top layer at the viewport origin, so "fixed" is the viewport. */
      position: fixed;
      top: 16px;
      right: 16px;
      width: min(300px, calc(100vw - 32px));
      max-height: calc(100vh - 32px);
      overflow: hidden auto;
      border: 1px solid var(--wv-border);
      border-radius: 12px;
      box-shadow: var(--wv-shadow);
      animation: wv-quiz-in 0.18s ease-out;
    }
    @keyframes wv-quiz-in { from { opacity: 0; transform: translateY(-6px); } }
    @media (prefers-reduced-motion: reduce) { .wv-quiz-floating { animation: none; } }

    .wv-quiz-head { display: flex; align-items: baseline; gap: 8px; min-height: 22px; margin-bottom: 2px; }
    .wv-quiz-title {
      flex: 1 1 auto;
      font-size: 11px;
      font-weight: 650;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--wv-muted);
    }
    /* "2 / 5" while a quiz asks several questions. */
    .wv-quiz-progress { font-size: 11.5px; font-weight: 600; color: var(--wv-muted); font-variant-numeric: tabular-nums; }
    .wv-quiz-word { font-size: 18px; font-weight: 650; line-height: 1.3; overflow-wrap: anywhere; }
    .wv-quiz-prompt { margin: 2px 0 10px; font-size: 12px; color: var(--wv-muted); }
    .wv-quiz-choices { display: grid; gap: 6px; }
    .wv-quiz-choice {
      margin: 0;
      padding: 7px 10px;
      border: 1px solid var(--wv-border);
      border-radius: 8px;
      background: transparent;
      color: var(--wv-fg);
      font: inherit;
      font-size: 13.5px;
      text-align: start;
      overflow-wrap: anywhere;
      cursor: pointer;
    }
    .wv-quiz-choice:hover:not(:disabled) { background: var(--wv-hover); }
    .wv-quiz-choice:focus-visible { outline: 2px solid var(--wv-accent); outline-offset: 1px; }
    .wv-quiz-choice:disabled { opacity: 0.55; cursor: default; }
    .wv-quiz-choice.wv-right { border-color: var(--wv-ok); color: var(--wv-ok); font-weight: 600; opacity: 1; }
    .wv-quiz-choice.wv-wrong { border-color: var(--wv-danger); color: var(--wv-danger); opacity: 1; }

    /* Below the choices: "I don't know" and "Ask later", replaced by the result once there is one. */
    .wv-quiz-foot { display: flex; align-items: center; min-height: 26px; margin-top: 8px; }
    .wv-quiz-actions { flex: 1 1 auto; display: flex; justify-content: space-between; gap: 8px; margin: 0 -6px; }
    .wv-quiz-action {
      margin: 0;
      padding: 4px 6px;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: var(--wv-muted);
      font: inherit;
      font-size: 12.5px;
      font-weight: 600;
      cursor: pointer;
    }
    .wv-quiz-action:hover { background: var(--wv-hover); color: var(--wv-fg); }
    .wv-quiz-action:focus-visible { outline: 2px solid var(--wv-accent); outline-offset: 1px; }
    .wv-quiz-feedback { font-size: 12.5px; font-weight: 600; }
    .wv-quiz-feedback.wv-right { color: var(--wv-ok); }
    .wv-quiz-feedback.wv-wrong { color: var(--wv-danger); }

    /* Writing: the meaning is shown, the word is typed. */
    .wv-quiz-write { display: flex; gap: 6px; }
    .wv-quiz-input {
      flex: 1 1 auto;
      min-width: 0;
      box-sizing: border-box;
      height: 34px;
      padding: 0 10px;
      border: 1px solid var(--wv-border);
      border-radius: 8px;
      background: var(--wv-bg);
      color: var(--wv-fg);
      font: inherit;
      font-size: 14px;
    }
    .wv-quiz-input:focus-visible { outline: 2px solid var(--wv-accent); outline-offset: 1px; }
    .wv-quiz-input.wv-right { border-color: var(--wv-ok); color: var(--wv-ok); font-weight: 600; opacity: 1; }
    .wv-quiz-input.wv-wrong { border-color: var(--wv-danger); color: var(--wv-danger); text-decoration: line-through; opacity: 1; }
    .wv-quiz-submit {
      flex: none;
      margin: 0;
      padding: 0 12px;
      border: 0;
      border-radius: 8px;
      background: var(--wv-accent);
      color: var(--wv-accent-fg);
      font: inherit;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }
    .wv-quiz-submit:disabled { opacity: 0.5; cursor: default; }
    .wv-quiz-submit:focus-visible { outline: 2px solid var(--wv-accent); outline-offset: 2px; }
    .wv-quiz-hint { margin: -4px 0 8px; font: 600 15px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; letter-spacing: 0.02em; color: var(--wv-muted); overflow-wrap: anywhere; }
    .wv-quiz-result { margin-top: 8px; }
    .wv-quiz-answer { font-size: 17px; font-weight: 650; color: var(--wv-ok); overflow-wrap: anywhere; }
    /* a letter the typed answer got wrong or left out */
    .wv-quiz-answer .wv-miss { color: var(--wv-danger); text-decoration: underline; text-decoration-thickness: 2px; text-underline-offset: 3px; }
    .wv-quiz-meaning { margin-top: 2px; font-size: 13px; color: var(--wv-muted); overflow-wrap: anywhere; }
    .wv-quiz-typed { margin-top: 2px; font-size: 12px; color: var(--wv-muted); overflow-wrap: anywhere; }
    .wv-quiz-action:disabled { opacity: 0.45; cursor: default; }

    /* Listening: a blank where the word would be, and the button that says it. */
    .wv-quiz-listen { display: flex; align-items: center; gap: 8px; }
    .wv-quiz-blank {
      flex: 1 1 auto;
      min-width: 0;
      min-height: 36px;
      box-sizing: border-box;
      display: flex;
      align-items: center;
      padding: 4px 12px;
      border: 1px dashed var(--wv-border);
      border-radius: 8px;
      color: var(--wv-muted);
      font-size: 18px;
      font-weight: 650;
      overflow-wrap: anywhere;
    }
    .wv-quiz-blank.wv-shown { border-style: solid; color: var(--wv-fg); }
    .wv-quiz-speaker {
      flex: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      margin: 0;
      padding: 0;
      border: 1px solid var(--wv-border);
      border-radius: 50%;
      background: var(--wv-tint);
      color: var(--wv-accent);
      cursor: pointer;
    }
    .wv-quiz-speaker svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .wv-quiz-speaker:hover { background: var(--wv-hover); }
    .wv-quiz-speaker:focus-visible { outline: 2px solid var(--wv-accent); outline-offset: 2px; }
    .wv-quiz-speaker.wv-busy { opacity: 0.6; }
    .wv-quiz-notice { margin: 0 0 8px; padding: 6px 10px; border-radius: 8px; background: var(--wv-tint); font-size: 12.5px; }

    .wv-quiz-streak { flex: none; display: inline-flex; align-items: center; }
    /* said once before "Not today" gives a streak up */
    .wv-quiz-warning { margin-top: 6px; padding: 6px 10px; border-radius: 8px; background: color-mix(in srgb, #f97316 14%, transparent); font-size: 12.5px; font-weight: 600; }

    /* Always there: "Not today" and "Close". */
    .wv-quiz-bottom {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      margin: 8px -6px 0;
      padding-top: 6px;
      border-top: 1px solid var(--wv-border);
    }
    .wv-quiz-bottom .wv-quiz-action { font-weight: 500; }

    /* "3/5 correct", at the end of a quiz with several questions. */
    .wv-quiz-summary { padding: 18px 0 14px; text-align: center; }
    .wv-quiz-score { font-size: 20px; font-weight: 650; }

    /* The time left to answer, along the bottom edge (shrunk by quiz-card.js). */
    .wv-quiz-timer { position: absolute; left: 0; right: 0; bottom: 0; height: 3px; }
    .wv-quiz-timer-bar { height: 100%; background: var(--wv-accent); opacity: 0.45; transform-origin: left center; }
  `;

  WV.styles = { host, tokens, controls, popup, quiz };
})(globalThis.WV);
