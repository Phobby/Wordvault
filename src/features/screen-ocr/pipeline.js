// From a screenshot to words on the page: cut out the area, get it ready, read it, weed out
// what is not text, map the boxes back. Runs in an extension page (Chrome: the offscreen
// document, Firefox: the background page), never in a web page.
//
// The picture exists only inside readCapture(): it is not stored, not sent anywhere, and its
// memory is given back before the function returns.

import { WordvaultError } from '../../lib/errors.js';
import { getEngine } from './engines/index.js';
import { DEFAULT_MIN_CONFIDENCE, filterWords, meanConfidence, mergeReadings } from './filters.js';
import { createMapping, placeOnPage, wholeViewport } from './geometry.js';
import { resolveLanguages } from './languages.js';
import { PROFILES, blankKind, chooseEnlargement, chooseProfiles, toGray } from './preprocess.js';

/** The engine's worker is kept for this long after a scan, then its memory is given back. */
export const IDLE_MS = 60_000;

let idleTimer = null;
let idleListener = () => {};

/** @param {() => void} listener  Called when the engine was shut down for being idle. */
export function onIdle(listener) {
  idleListener = listener;
}

function keepAlive(engine) {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    await engine.terminate().catch(() => {});
    idleListener();
  }, IDLE_MS);
}

/**
 * @param {Object} request
 * @param {string} request.dataUrl   The screenshot of the tab.
 * @param {{ x: number, y: number, width: number, height: number } | null} request.area  CSS px; null: everything.
 * @param {import('./geometry.js').Viewport} request.viewport
 * @param {string | string[]} [request.languages]  'auto' or language tags.
 * @param {number} [request.minConfidence]
 * @param {string} [request.engine]
 * @param {(progress: { stage: string, progress: number }) => void} [onProgress]
 */
export async function readCapture(request, onProgress = () => {}) {
  const started = Date.now();
  const engine = getEngine(request.engine);
  const languages = resolveLanguages(request.languages);
  const minConfidence = Number.isFinite(request.minConfidence) ? request.minConfidence : DEFAULT_MIN_CONFIDENCE;
  clearTimeout(idleTimer);

  let bitmap = null;
  let canvas = null;
  let stage = null;
  try {
    bitmap = await createImageBitmap(await (await fetch(request.dataUrl)).blob());
    const mapping = createMapping(bitmap, request.viewport);
    const crop = mapping.toImage(request.area || wholeViewport(request.viewport));
    if (!crop) throw new WordvaultError('ocr_no_text', 'the area is outside the picture');
    const area = mapping.toPage({ x: 0, y: 0, width: crop.width, height: crop.height }, crop);

    const enlargement = chooseEnlargement(mapping.scaleY, crop.width, crop.height);
    canvas = new OffscreenCanvas(Math.round(crop.width * enlargement), Math.round(crop.height * enlargement));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    bitmap = null;
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const enlargedX = canvas.width / crop.width;
    const enlargedY = canvas.height / crop.height;

    const gray = toGray(pixels);
    const blank = blankKind(gray);
    if (blank === 'black') throw new WordvaultError('ocr_blank', 'the picture is black');
    const info = {
      engine: engine.id,
      languages,
      image: { width: crop.width, height: crop.height },
      scaleX: mapping.scaleX,
      scaleY: mapping.scaleY,
      enlargement,
    };
    if (blank) return { words: [], lines: [], blocks: [], area, info: { ...info, ms: Date.now() - started, found: 0, meanConfidence: 0, dropped: {} } };

    onProgress({ stage: 'loading', progress: 0 });
    stage = new OffscreenCanvas(canvas.width, canvas.height);
    const stageContext = stage.getContext('2d');
    const profiles = chooseProfiles(gray);
    let passes = 0;
    const read = async (profile) => {
      const prepared = PROFILES[profile](pixels);
      stageContext.putImageData(new ImageData(prepared.data, prepared.width, prepared.height), 0, 0);
      const blob = await stage.convertToBlob({ type: 'image/png' });
      const pass = passes++;
      // the readings share one progress bar
      await engine.init(languages, (progress) => onProgress(progress.stage === 'reading' ? { stage: 'reading', progress: (pass + progress.progress) / profiles.length } : progress));
      const found = await engine.recognize(blob);
      // back to pixels of the crop, whatever the enlargement was
      return found.words.map((word) => ({
        ...word,
        bbox: { x: word.bbox.x / enlargedX, y: word.bbox.y / enlargedY, width: word.bbox.width / enlargedX, height: word.bbox.height / enlargedY },
      }));
    };

    // Several readings of the same picture: as a page (dark text on light), turned over when
    // it has dark parts (light text on dark), and as a film frame with a caption on it. Each
    // is weeded on its own; where two found a line in the same place, the better reading of
    // that line is the one that is shown.
    const filterOptions = { minConfidence, pixelsPerCss: mapping.scaleY };
    let kept = [];
    let found = 0;
    const dropped = {};
    for (const profile of profiles) {
      const words = await read(profile);
      const weeded = filterWords(words, filterOptions);
      kept = mergeReadings(kept, weeded.kept);
      if (profile === profiles[0]) {
        found = words.length;
        Object.assign(dropped, weeded.dropped);
      }
    }
    const raw = { length: found };
    const placed = placeOnPage({ words: kept }, mapping, crop);
    return {
      ...placed,
      area,
      info: { ...info, ms: Date.now() - started, found: raw.length, meanConfidence: Math.round(meanConfidence(kept)), dropped },
    };
  } finally {
    // The picture is gone before anyone hears about the result.
    bitmap?.close();
    for (const surface of [canvas, stage]) if (surface) surface.width = surface.height = 0;
    keepAlive(engine);
  }
}
