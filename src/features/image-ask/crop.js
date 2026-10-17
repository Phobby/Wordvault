// "Ask about the image": the part of the screenshot the user chose, as a picture small enough to
// send. Runs in the background script (Chrome's service worker has OffscreenCanvas too). The
// screenshot itself is not kept; what comes out goes to the page's panel and, only when the
// user presses "Ask", to their AI provider.

import { WordvaultError } from '../../lib/errors.js';
import { toBase64 } from '../../sync/bytes.js';
import { createMapping, wholeViewport } from '../screen-ocr/geometry.js';

/** The longer side of the picture that is sent, in pixels. Providers scale larger ones down anyway. */
export const MAX_SIDE = 1536;
/** JPEG: a photo or a video frame is a fraction of its PNG size, and every provider takes it. */
const QUALITY = 0.85;

/** How much smaller the crop has to become so that neither side is longer than `maxSide`. */
export function fitScale(width, height, maxSide = MAX_SIDE) {
  const longer = Math.max(width, height);
  return longer > maxSide ? maxSide / longer : 1;
}

/**
 * @param {string} dataUrl  The screenshot of the tab.
 * @param {{ x: number, y: number, width: number, height: number } | null} area  CSS px; null: everything.
 * @param {import('../screen-ocr/geometry.js').Viewport} viewport
 * @returns {Promise<{ mime: 'image/jpeg', data: string, width: number, height: number }>} data: base64.
 */
export async function cropCapture(dataUrl, area, viewport) {
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  let canvas = null;
  try {
    const mapping = createMapping(bitmap, viewport);
    const crop = mapping.toImage(area || wholeViewport(viewport));
    if (!crop) throw new WordvaultError('image_empty', 'the area is outside the picture');
    const scale = fitScale(crop.width, crop.height);
    const width = Math.max(1, Math.round(crop.width * scale));
    const height = Math.max(1, Math.round(crop.height * scale));
    canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: QUALITY });
    return { mime: 'image/jpeg', data: toBase64(new Uint8Array(await blob.arrayBuffer())), width, height };
  } finally {
    bitmap.close();
    if (canvas) canvas.width = canvas.height = 0;
  }
}
