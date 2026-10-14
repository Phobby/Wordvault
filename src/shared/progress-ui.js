'use strict';

// The streak flame, the rank badge and the little celebration for a new rank. Drawn here,
// from shapes of our own: no image file, nothing from the network. All movement is CSS and
// stands still for whoever asked for reduced motion.

(function (WV) {
  if (!WV || WV.progressUi) return;
  const { h, t } = WV;
  const SVG = 'http://www.w3.org/2000/svg';

  function svg(viewBox, className, children) {
    const element = document.createElementNS(SVG, 'svg');
    element.setAttribute('viewBox', viewBox);
    element.setAttribute('class', className);
    element.setAttribute('aria-hidden', 'true');
    for (const [tag, attributes] of children) {
      const child = document.createElementNS(SVG, tag);
      for (const [name, value] of Object.entries(attributes)) child.setAttribute(name, value);
      element.append(child);
    }
    return element;
  }

  /**
   * The flame with the number of days next to it. Alive (bright, flickering) when today's quiz
   * is done; pale when it is still to do; grey when there is no streak.
   * @param {{ count: number, todayDone: boolean, alive: boolean }} streak
   */
  function flame(streak) {
    const count = Number(streak?.count) || 0;
    const state = streak?.todayDone ? 'lit' : streak?.alive ? 'waiting' : 'out';
    const label = count === 0 ? t('streakNone') : t(streak.todayDone ? 'streakDone' : 'streakWaiting', { count });
    return h(
      'span',
      { class: `wv-streak wv-streak-${state}`, role: 'img', 'aria-label': label, title: label, 'data-count': String(count), 'data-state': state },
      svg('0 0 24 24', 'wv-flame', [
        ['path', { class: 'wv-flame-outer', d: 'M12 2.5c.6 3.6-1.200 5.200-2.800 7C7.400 11.500 6 13.300 6 15.700 6 19.200 8.700 22 12 22s6-2.800 6-6.300c0-2.300-1-4-2.200-5.500-.5 1.300-1.200 2-2.200 2.400.7-3.400-.200-7.100-1.600-10.100z' }],
        ['path', { class: 'wv-flame-inner', d: 'M12 12.200c.3 1.700-.700 2.500-1.500 3.500-.600.700-1 1.500-1 2.500 0 1.700 1.100 3 2.500 3s2.500-1.300 2.500-3c0-2.200-1.600-3.600-2.500-6z' }],
      ]),
      h('span', { class: 'wv-streak-count', text: String(count) }),
    );
  }

  /** The badge of a rank: a shield in the rank's colours with one pip per step up the ladder. */
  function rankBadge(rank) {
    const steps = Math.max(1, Math.min(7, (Number(rank?.index) || 0) + 1));
    const pips = [];
    const width = 2.2;
    const gap = 1;
    const start = 16 - (steps * width + (steps - 1) * gap) / 2;
    for (let index = 0; index < steps; index++) pips.push(['rect', { class: 'wv-rank-pip', x: String(start + index * (width + gap)), y: '14', width: String(width), height: '6', rx: '1' }]);
    return h(
      'span',
      { class: `wv-rank-badge wv-rank-${rank?.tone || 'slate'}`, 'aria-hidden': 'true' },
      svg('0 0 32 32', 'wv-rank-shield', [['path', { class: 'wv-rank-shape', d: 'M16 2.500l11 3.800v8.200c0 7-4.600 12.300-11 15-6.400-2.700-11-8-11-15V6.300z' }], ['path', { class: 'wv-rank-shine', d: 'M16 5.200l8.400 2.900v2.400L16 7.600 7.600 10.500V8.100z' }], ...pips]),
    );
  }

  /**
   * Badge, name, a bar for the way to the next rank and how many words are left.
   * @param {Object} rank  quiz/progress.js: rankOf().
   */
  function rankPanel(rank) {
    const name = t(rank.nameKey);
    const percent = Math.round(Math.max(0, Math.min(1, rank.progress)) * 100);
    // set through the style object, not a style attribute: a page's content security policy may forbid those
    const fill = h('div', { class: 'wv-rank-fill' });
    fill.style.width = `${percent}%`;
    const remaining = rank.next ? t('rankRemaining', { count: rank.remaining, rank: t(rank.next.nameKey) }) : t('rankTop');
    return h(
      'div',
      { class: 'wv-rank', 'data-rank': rank.id },
      rankBadge(rank),
      h(
        'div',
        { class: 'wv-rank-text' },
        h('div', { class: 'wv-rank-line' }, h('strong', { class: 'wv-rank-name', text: name }), h('span', { class: 'wv-rank-learned', text: t('rankLearned', { count: rank.learned }) })),
        h('div', { class: 'wv-rank-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(percent), 'aria-label': remaining }, fill),
        h('div', { class: 'wv-rank-remaining', text: remaining }),
      ),
    );
  }

  /** How long the celebration stays before it takes itself away. */
  const CELEBRATION_MS = 4200;
  const CONFETTI = 14;

  /**
   * A short celebration of a new rank, laid over `container`. It goes away by itself, or when
   * it is clicked.
   * @returns {HTMLElement}
   */
  function celebrate(container, rank, onDone) {
    const pieces = [];
    for (let index = 0; index < CONFETTI; index++) {
      const piece = h('span', { class: 'wv-confetti' });
      piece.style.setProperty('--x', `${Math.round((index / (CONFETTI - 1)) * 100)}%`);
      piece.style.setProperty('--delay', `${(index % 5) * 90}ms`);
      piece.style.setProperty('--turn', String(index % 2 ? 1 : -1));
      piece.style.setProperty('--hue', String((index * 47) % 360));
      pieces.push(piece);
    }
    let done = false;
    const overlay = h(
      'div',
      {
        class: 'wv-celebrate',
        role: 'status',
        onclick: () => finish(),
      },
      h('div', { class: 'wv-confetti-field', 'aria-hidden': 'true' }, pieces),
      h('div', { class: 'wv-celebrate-card' }, rankBadge(rank), h('div', { class: 'wv-celebrate-title', text: t('rankUpTitle') }), h('div', { class: 'wv-celebrate-name', text: t(rank.nameKey) })),
    );
    function finish() {
      if (done) return;
      done = true;
      overlay.remove();
      onDone?.();
    }
    container.append(overlay);
    setTimeout(finish, CELEBRATION_MS);
    return overlay;
  }

  const css = `
    /* --- streak --- */
    .wv-streak { display: inline-flex; align-items: center; gap: 2px; font-size: 12.5px; font-weight: 650; font-variant-numeric: tabular-nums; line-height: 1; white-space: nowrap; }
    .wv-flame { width: 16px; height: 16px; flex: none; transform-origin: 50% 90%; }
    .wv-streak-lit { color: #c2410c; }
    .wv-streak-lit .wv-flame-outer { fill: #f97316; }
    .wv-streak-lit .wv-flame-inner { fill: #fde047; }
    .wv-streak-lit .wv-flame { animation: wv-flicker 1.6s ease-in-out infinite; }
    .wv-streak-lit .wv-flame-inner { animation: wv-glow 1.1s ease-in-out infinite alternate; transform-origin: 50% 90%; transform-box: fill-box; }
    /* still to do today: the same flame, pale and still */
    .wv-streak-waiting { color: var(--wv-muted); }
    .wv-streak-waiting .wv-flame-outer { fill: #f97316; opacity: 0.4; }
    .wv-streak-waiting .wv-flame-inner { fill: #fde047; opacity: 0.45; }
    .wv-streak-out { color: var(--wv-muted); }
    .wv-streak-out .wv-flame-outer { fill: currentColor; opacity: 0.35; }
    .wv-streak-out .wv-flame-inner { fill: var(--wv-bg); opacity: 0.6; }
    @keyframes wv-flicker { 0%, 100% { transform: scale(1) rotate(-2deg); } 35% { transform: scale(1.07, 1.12) rotate(2deg); } 70% { transform: scale(0.96, 1.03) rotate(-1deg); } }
    @keyframes wv-glow { from { transform: scale(0.88); opacity: 0.85; } to { transform: scale(1.08); opacity: 1; } }

    /* --- rank --- */
    .wv-rank { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .wv-rank-badge { flex: none; display: inline-flex; --rank-a: #64748b; --rank-b: #94a3b8; --rank-pip: #ffffff; }
    .wv-rank-shield { width: 34px; height: 34px; }
    .wv-rank-shape { fill: var(--rank-a); stroke: var(--rank-b); stroke-width: 1.5; stroke-linejoin: round; }
    .wv-rank-shine { fill: var(--rank-b); opacity: 0.55; }
    .wv-rank-pip { fill: var(--rank-pip); }
    .wv-rank-slate { --rank-a: #64748b; --rank-b: #94a3b8; }
    .wv-rank-green { --rank-a: #15803d; --rank-b: #4ade80; }
    .wv-rank-blue { --rank-a: #1d4ed8; --rank-b: #60a5fa; }
    .wv-rank-violet { --rank-a: #6d28d9; --rank-b: #a78bfa; }
    .wv-rank-crimson { --rank-a: #9f1239; --rank-b: #fb7185; }
    .wv-rank-gold { --rank-a: #a16207; --rank-b: #facc15; --rank-pip: #fffbeb; }
    .wv-rank-aurora { --rank-a: #0f766e; --rank-b: #f0abfc; --rank-pip: #fef9c3; }
    .wv-rank-text { flex: 1 1 auto; min-width: 0; display: grid; gap: 3px; }
    .wv-rank-line { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
    .wv-rank-name { font-size: 13.5px; font-weight: 650; }
    .wv-rank-learned, .wv-rank-remaining { font-size: 11.5px; color: var(--wv-muted); }
    .wv-rank-bar { height: 6px; border-radius: 3px; background: var(--wv-hover); overflow: hidden; }
    .wv-rank-fill { height: 100%; border-radius: 3px; background: var(--wv-accent); transition: width 0.4s ease-out; }

    /* --- a new rank --- */
    .wv-celebrate { position: absolute; inset: 0; z-index: 5; display: flex; align-items: center; justify-content: center; overflow: hidden; background: color-mix(in srgb, var(--wv-bg) 86%, transparent); cursor: pointer; animation: wv-fade-in 0.2s ease-out; }
    .wv-celebrate-card { display: grid; justify-items: center; gap: 4px; padding: 14px 22px; border-radius: 14px; background: var(--wv-bg); box-shadow: var(--wv-shadow); animation: wv-pop 0.5s cubic-bezier(0.2, 1.4, 0.4, 1); }
    .wv-celebrate-card .wv-rank-shield { width: 56px; height: 56px; }
    .wv-celebrate-title { font-size: 12px; font-weight: 650; letter-spacing: 0.04em; text-transform: uppercase; color: var(--wv-muted); }
    .wv-celebrate-name { font-size: 20px; font-weight: 700; }
    .wv-confetti-field { position: absolute; inset: 0; pointer-events: none; }
    .wv-confetti { position: absolute; top: -12px; left: var(--x); width: 7px; height: 11px; border-radius: 2px; background: hsl(var(--hue) 85% 58%); animation: wv-fall 2.4s var(--delay) cubic-bezier(0.3, 0.1, 0.6, 1) forwards; }
    @keyframes wv-fall { to { transform: translateY(420px) rotate(calc(var(--turn) * 540deg)); opacity: 0.2; } }
    @keyframes wv-pop { from { transform: scale(0.6); opacity: 0; } }
    @keyframes wv-fade-in { from { opacity: 0; } }

    @media (prefers-reduced-motion: reduce) {
      .wv-streak-lit .wv-flame, .wv-streak-lit .wv-flame-inner, .wv-celebrate, .wv-celebrate-card { animation: none; }
      .wv-confetti { display: none; }
      .wv-rank-fill { transition: none; }
    }
  `;

  WV.progressUi = { flame, rankBadge, rankPanel, celebrate, css };
  // The quiz card shows the flame, wherever it is drawn (its styles go where the card's go).
  if (WV.styles) {
    WV.styles.progress = css;
    WV.styles.quiz += css;
  }
})(globalThis.WV);
