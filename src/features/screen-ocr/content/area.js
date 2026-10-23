'use strict';

// The scan area as numbers: made by dragging, adjusted by its edges, kept inside the viewport.
// No DOM here, so the rules can be tested as they are.

(function (WV) {
  if (WV.ocrArea) return;

  /** Anything smaller than this (CSS px, either way) is a click, not an area. */
  const MIN_SIZE = 12;

  const clamp = (value, min, max) => Math.max(min, Math.min(value, max));

  /**
   * The box between where a drag started and where the pointer is now.
   * @param {{ x: number, y: number }} from
   * @param {{ x: number, y: number }} to
   * @param {{ width: number, height: number }} bounds  The viewport.
   */
  function fromDrag(from, to, bounds) {
    const x1 = clamp(Math.min(from.x, to.x), 0, bounds.width);
    const y1 = clamp(Math.min(from.y, to.y), 0, bounds.height);
    const x2 = clamp(Math.max(from.x, to.x), 0, bounds.width);
    const y2 = clamp(Math.max(from.y, to.y), 0, bounds.height);
    return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
  }

  const isUsable = (box) => Boolean(box) && box.width >= MIN_SIZE && box.height >= MIN_SIZE;

  /**
   * The box after one of its handles was dragged.
   * @param {{ x: number, y: number, width: number, height: number }} box  As it was when the drag started.
   * @param {string} handle  Which edges move: a combination of n, s, e, w ('ne', 'w' …), or 'move'.
   * @param {number} dx  How far the pointer has moved since.
   * @param {number} dy
   * @param {{ width: number, height: number }} bounds
   */
  function adjust(box, handle, dx, dy, bounds) {
    if (handle === 'move') {
      return {
        x: clamp(box.x + dx, 0, Math.max(0, bounds.width - box.width)),
        y: clamp(box.y + dy, 0, Math.max(0, bounds.height - box.height)),
        width: box.width,
        height: box.height,
      };
    }
    let left = box.x;
    let top = box.y;
    let right = box.x + box.width;
    let bottom = box.y + box.height;
    // An edge stops at the viewport and at the minimum size: it never passes the opposite one.
    if (handle.includes('w')) left = clamp(left + dx, 0, right - MIN_SIZE);
    if (handle.includes('e')) right = clamp(right + dx, left + MIN_SIZE, bounds.width);
    if (handle.includes('n')) top = clamp(top + dy, 0, bottom - MIN_SIZE);
    if (handle.includes('s')) bottom = clamp(bottom + dy, top + MIN_SIZE, bounds.height);
    return { x: left, y: top, width: right - left, height: bottom - top };
  }

  /**
   * An area remembered from an earlier scan, fitted to the viewport as it is now; null if it
   * no longer makes sense there.
   */
  function restore(saved, bounds) {
    if (!saved || ![saved.x, saved.y, saved.width, saved.height].every(Number.isFinite)) return null;
    const width = Math.min(saved.width, bounds.width);
    const height = Math.min(saved.height, bounds.height);
    const box = { x: clamp(saved.x, 0, bounds.width - width), y: clamp(saved.y, 0, bounds.height - height), width, height };
    return isUsable(box) ? box : null;
  }

  /** A box picked by pointing at it is at least this large (CSS px); smaller ones give way to the one around them. */
  const PICK_MIN_WIDTH = 40;
  const PICK_MIN_HEIGHT = 18;
  /** A box that covers this much of the viewport both ways is the page's frame, not a part of it. */
  const PICK_MAX_SHARE = 0.9;
  /** Elements that are a picture by themselves, whatever their display. */
  const REPLACED = new Set(['img', 'video', 'canvas', 'svg', 'iframe', 'embed', 'object', 'picture']);

  /**
   * The part of the page a click would scan, as the browser's own screenshot tool picks it: the
   * element under the pointer, or the nearest one around it that is a box of its own (not a run
   * of text inside a line) and large enough to be worth scanning. The page's frame (html, body,
   * or anything that fills the viewport) is never picked: that is what dragging or Enter is for.
   *
   * @param {{ tag: string, display: string, rect: { left: number, top: number, width: number, height: number } }[]} chain
   *        The element under the pointer first, then its ancestors.
   * @param {{ width: number, height: number }} bounds  The viewport.
   * @returns {{ x: number, y: number, width: number, height: number } | null}  Clipped to the viewport.
   */
  function pick(chain, bounds) {
    for (const element of chain) {
      if (element.tag === 'html' || element.tag === 'body') return null;
      const { rect } = element;
      const picture = REPLACED.has(element.tag);
      const inline = element.display.startsWith('inline') && element.display !== 'inline-block' && element.display !== 'inline-flex' && element.display !== 'inline-grid';
      if ((!picture && (inline || element.display === 'contents')) || rect.width < PICK_MIN_WIDTH || rect.height < PICK_MIN_HEIGHT) continue;
      if (!picture && rect.width >= bounds.width * PICK_MAX_SHARE && rect.height >= bounds.height * PICK_MAX_SHARE) return null;
      const box = fromDrag({ x: rect.left, y: rect.top }, { x: rect.left + rect.width, y: rect.top + rect.height }, bounds);
      return isUsable(box) ? box : null;
    }
    return null;
  }

  WV.ocrArea = { MIN_SIZE, fromDrag, isUsable, adjust, restore, pick };
})(globalThis.WV);
