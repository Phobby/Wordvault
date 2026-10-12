// Screen text scanning, the part that runs in the extension's own context: take the picture of
// the tab, cut out the selected area, hand it to the engine, put what it found back on the
// page. The picture never leaves this function: it is not stored, not sent anywhere, and its
// memory is released before the result is returned.

import { WordvaultError } from '../../lib/errors.js';
import { mockEngine } from './engines/mock.js';
import { createMapping, placeOnPage, wholeViewport } from './geometry.js';

/** ASSUMPTION: until the real engines arrive (stage 2 of SPEC-OCR.md) the stand-in is the engine. */
const engine = mockEngine;

/** What the browsers say when a tab may not be photographed, turned into our error codes. */
export function captureErrorCode(message) {
  const text = String(message || '');
  if (/MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND|quota|too many/i.test(text)) return 'ocr_rate';
  if (/permission|activeTab|cannot access|not allowed|cannot be (edited|captured)|chrome:\/\/|extensions gallery/i.test(text)) return 'ocr_forbidden';
  return 'ocr_capture';
}

async function capture(windowId) {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
    if (!dataUrl) throw new Error('empty capture');
    return dataUrl;
  } catch (error) {
    const detail = String(error?.message || error);
    throw new WordvaultError(captureErrorCode(detail), detail);
  }
}

/**
 * @param {Object} request
 * @param {{ x: number, y: number, width: number, height: number } | null} request.area
 *        The selected area, CSS px relative to the viewport; null for everything visible.
 * @param {import('./geometry.js').Viewport} request.viewport
 * @param {{ id: number, windowId: number }} tab
 * @param {(stage: string) => void} [onStage]  Called when the picture has been taken, so that
 *        the page can show that it is being read (anything shown earlier would be in it).
 */
export async function scanTab({ area, viewport }, tab, onStage = () => {}) {
  const started = Date.now();
  const dataUrl = await capture(tab.windowId);
  onStage('reading');

  let bitmap = null;
  let canvas = null;
  try {
    bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
    const mapping = createMapping(bitmap, viewport);
    const wanted = area || wholeViewport(viewport);
    const crop = mapping.toImage(wanted);
    if (!crop) throw new WordvaultError('ocr_no_text', 'the area is outside the picture');

    canvas = new OffscreenCanvas(crop.width, crop.height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(bitmap, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
    const pixels = context.getImageData(0, 0, crop.width, crop.height);

    await engine.init('');
    const found = await engine.recognize(pixels);
    const placed = placeOnPage(found, mapping, crop);
    return {
      ...placed,
      area: mapping.toPage({ x: 0, y: 0, width: crop.width, height: crop.height }, crop),
      info: {
        engine: engine.id,
        ms: Date.now() - started,
        image: { width: bitmap.width, height: bitmap.height },
        crop: { width: crop.width, height: crop.height },
        scaleX: mapping.scaleX,
        scaleY: mapping.scaleY,
        words: placed.words.length,
      },
    };
  } finally {
    // The picture is gone before anyone hears about the result.
    bitmap?.close();
    if (canvas) canvas.width = canvas.height = 0;
  }
}
