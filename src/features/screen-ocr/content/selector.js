'use strict';

// Choosing the area to scan: the page dims, the pointer becomes a cross, and the user drags a
// rectangle that can then be adjusted by its edges. Lives in its own shadow surface; the page
// is not changed.

(function (WV) {
  if (!WV.supported || !WV.ocrArea || WV.ocrSelector) return;
  const { h, t } = WV;

  const HANDLES = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];

  const CSS = `
    .wv-ocr-shade {
      position: fixed; inset: 0; cursor: crosshair; touch-action: none;
      background: rgba(0, 0, 0, 0.38); user-select: none; -webkit-user-select: none;
    }
    /* With an area on screen the dimming is drawn by the area itself, around it. */
    .wv-ocr-shade.wv-has-area { background: transparent; }
    .wv-ocr-area {
      position: fixed; cursor: move;
      border: 1.5px solid #ffffff; outline: 1px solid rgba(0, 0, 0, 0.6);
      box-shadow: 0 0 0 100vmax rgba(0, 0, 0, 0.38);
    }
    .wv-ocr-handle {
      position: absolute; width: 12px; height: 12px; margin: -6px;
      background: #ffffff; border: 1px solid rgba(0, 0, 0, 0.7); border-radius: 50%;
    }
    .wv-ocr-handle[data-handle="n"]  { top: 0; left: 50%; cursor: ns-resize; }
    .wv-ocr-handle[data-handle="s"]  { top: 100%; left: 50%; cursor: ns-resize; }
    .wv-ocr-handle[data-handle="e"]  { top: 50%; left: 100%; cursor: ew-resize; }
    .wv-ocr-handle[data-handle="w"]  { top: 50%; left: 0; cursor: ew-resize; }
    .wv-ocr-handle[data-handle="ne"] { top: 0; left: 100%; cursor: nesw-resize; }
    .wv-ocr-handle[data-handle="sw"] { top: 100%; left: 0; cursor: nesw-resize; }
    .wv-ocr-handle[data-handle="nw"] { top: 0; left: 0; cursor: nwse-resize; }
    .wv-ocr-handle[data-handle="se"] { top: 100%; left: 100%; cursor: nwse-resize; }
    .wv-ocr-bar {
      position: fixed; display: flex; gap: 6px; padding: 6px; cursor: default;
      background: var(--wv-bg); border: 1px solid var(--wv-border); border-radius: 10px; box-shadow: var(--wv-shadow);
    }
    .wv-ocr-hint {
      position: fixed; top: 14px; left: 50%; transform: translateX(-50%); max-width: calc(100vw - 24px);
      padding: 7px 12px; border-radius: 999px; pointer-events: none; text-align: center;
      background: var(--wv-bg); color: var(--wv-fg); border: 1px solid var(--wv-border); box-shadow: var(--wv-shadow);
    }
  `;

  /** Distance between the area and its buttons, and between the buttons and the viewport edge. */
  const GAP = 8;

  let ui = null;
  let state = null; // { area, drag, resolve } while the selector is on screen

  const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });

  function build() {
    const surface = WV.createSurface(CSS);
    const area = h('div', { class: 'wv-ocr-area', hidden: true }, HANDLES.map((handle) => h('div', { class: 'wv-ocr-handle', 'data-handle': handle })));
    const bar = h(
      'div',
      { class: 'wv-ocr-bar', hidden: true },
      h('button', { class: 'wv-btn wv-btn-sm wv-btn-primary', type: 'button', text: t('ocrScan'), onclick: () => finish(state.area) }),
      h('button', { class: 'wv-btn wv-btn-sm', type: 'button', text: t('ocrCancel'), onclick: () => finish(undefined) }),
    );
    const hint = h('div', { class: 'wv-ocr-hint', role: 'status', text: t('ocrHint') });
    const shade = h('div', { class: 'wv-ocr-shade' }, area, bar, hint);
    shade.addEventListener('pointerdown', onPointerDown);
    shade.addEventListener('pointermove', onPointerMove);
    shade.addEventListener('pointerup', onPointerUp);
    shade.addEventListener('pointercancel', onPointerUp);
    shade.addEventListener('dblclick', onDoubleClick);
    surface.root.append(shade);
    return { surface, shade, area, bar, hint };
  }

  function render() {
    const { area } = state;
    const shown = WV.ocrArea.isUsable(area) || Boolean(state.drag && area);
    ui.shade.classList.toggle('wv-has-area', shown);
    ui.area.hidden = !shown;
    // The buttons wait until the drag is over: they would be in the way of it.
    ui.bar.hidden = !shown || Boolean(state.drag);
    ui.hint.hidden = shown; // it has said what it had to, and would sit on the area
    if (!shown) return;
    Object.assign(ui.area.style, { left: `${area.x}px`, top: `${area.y}px`, width: `${area.width}px`, height: `${area.height}px` });
    if (ui.bar.hidden) return;
    const { width, height } = viewport();
    const barWidth = ui.bar.offsetWidth;
    const barHeight = ui.bar.offsetHeight;
    // Under the area, or inside its lower edge when there is no room under it.
    const below = area.y + area.height + GAP + barHeight <= height - GAP;
    const top = below ? area.y + area.height + GAP : area.y + area.height - barHeight - GAP;
    const left = Math.max(GAP, Math.min(area.x + area.width - barWidth, width - barWidth - GAP));
    Object.assign(ui.bar.style, { left: `${left}px`, top: `${Math.max(GAP, top)}px` });
  }

  function onPointerDown(event) {
    if (event.button !== 0 || ui.bar.contains(event.target)) return;
    event.preventDefault();
    const point = { x: event.clientX, y: event.clientY };
    const handle = event.target.dataset?.handle || (event.target === ui.area ? 'move' : null);
    // On the area: adjust it. Anywhere else: start a new one.
    state.drag = handle ? { handle, from: point, box: state.area } : { handle: null, from: point, box: null };
    if (!handle) state.area = null;
    ui.shade.setPointerCapture(event.pointerId);
    render();
  }

  function onPointerMove(event) {
    const { drag } = state;
    if (!drag) return;
    const point = { x: event.clientX, y: event.clientY };
    state.area = drag.handle
      ? WV.ocrArea.adjust(drag.box, drag.handle, point.x - drag.from.x, point.y - drag.from.y, viewport())
      : WV.ocrArea.fromDrag(drag.from, point, viewport());
    render();
  }

  function onPointerUp(event) {
    if (!state.drag) return;
    state.drag = null;
    if (ui.shade.hasPointerCapture(event.pointerId)) ui.shade.releasePointerCapture(event.pointerId);
    if (!WV.ocrArea.isUsable(state.area)) state.area = null; // a click, not a drag
    render();
  }

  /** A double-click outside the area scans everything that is visible. */
  function onDoubleClick(event) {
    if (ui.area.contains(event.target) || ui.bar.contains(event.target)) return;
    finish(null);
  }

  function onKeyDown(event) {
    if (event.isComposing || (event.key !== 'Escape' && event.key !== 'Enter')) return;
    // While the selector is up these two keys are its own, whatever the page does with them.
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.key === 'Escape') finish(undefined);
    else finish(WV.ocrArea.isUsable(state.area) ? state.area : null);
  }

  const swallowKeyUp = (event) => {
    if (event.key === 'Escape' || event.key === 'Enter') event.stopImmediatePropagation();
  };

  function finish(result) {
    if (!state) return;
    const { resolve } = state;
    state = null;
    window.removeEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', swallowKeyUp, { capture: true, once: true });
    ui.surface.unmount();
    resolve(result);
  }

  /**
   * Shows the selector and waits for the user.
   * @param {{ initial?: Object | null }} [options]  `initial`: an area to start with (the last one used).
   * @returns {Promise<{ x: number, y: number, width: number, height: number } | null | undefined>}
   *          The area in CSS px of the viewport; null: everything visible; undefined: cancelled.
   */
  function choose({ initial = null } = {}) {
    if (state) finish(undefined);
    ui ||= build();
    return new Promise((resolve) => {
      state = { area: WV.ocrArea.restore(initial, viewport()), drag: null, resolve };
      window.addEventListener('keydown', onKeyDown, true);
      ui.surface.mount();
      render();
    });
  }

  WV.ocrSelector = { choose, isOpen: () => Boolean(state), cancel: () => finish(undefined) };
})(globalThis.WV);
