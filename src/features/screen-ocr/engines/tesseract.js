// Tesseract.js as an engine. The library, its worker, the WebAssembly core and the language
// data are all files of the extension (vendor/tesseract, unmodified); nothing is fetched from
// the network. Needs a context that can start a Worker: an extension page, not a service worker.

import Tesseract from '../../../vendor/tesseract/tesseract.esm.min.js';
import { BUNDLED_LANGUAGES } from '../languages.js';

const BASE = new URL('../../../vendor/tesseract/', import.meta.url).href;
/** LSTM only: the legacy engine's code and data are not shipped. */
const OEM_LSTM = 1;
/**
 * Page segmentation "sparse text": find as much text as possible, in no particular order. A
 * screen is not a page of prose; captions, labels and signs sit anywhere on it.
 */
const PSM_SPARSE = '11';
/**
 * Tesseract writes notes such as "Estimating resolution as 606" to its error stream on every
 * scan; the core passes that to console.error, and Chrome lists it under the extension's
 * "Errors". Sent to the engine's own null file instead, they are not written anywhere.
 */
const QUIET = '/dev/null';

let worker = null;
let loaded = ''; // the languages the worker has ready, e.g. 'eng+tur'
let report = () => {};

function onLog(message) {
  if (!message || typeof message.status !== 'string') return;
  const reading = message.status.includes('recogniz');
  report({ stage: reading ? 'reading' : 'loading', progress: typeof message.progress === 'number' ? message.progress : 0 });
}

export const tesseractEngine = {
  id: 'tesseract',

  /**
   * Makes the engine ready for a set of languages. Cheap when it already is.
   * @param {string} languages  Engine codes joined with '+', e.g. 'eng+tur'.
   * @param {(progress: { stage: 'loading' | 'reading', progress: number }) => void} [onProgress]
   */
  async init(languages, onProgress = () => {}) {
    report = onProgress;
    if (worker && loaded === languages) return;
    if (worker) {
      await worker.reinitialize(languages.split('+'), OEM_LSTM);
    } else {
      worker = await Tesseract.createWorker(languages.split('+'), OEM_LSTM, {
        workerPath: `${BASE}worker.min.js`,
        corePath: `${BASE}core`,
        langPath: `${BASE}lang`,
        workerBlobURL: false, // a blob: worker could not load the core from the extension's files
        gzip: true,
        cacheMethod: 'none', // the data is already on disk, inside the extension
        logger: onLog,
        errorHandler: () => {},
      });
    }
    // After a change of languages as well: starting the engine again may forget them.
    await worker.setParameters({ tessedit_pageseg_mode: PSM_SPARSE, debug_file: QUIET });
    loaded = languages;
  },

  /**
   * @param {Blob} image
   * @returns {Promise<{ words: { text: string, bbox: { x: number, y: number, width: number, height: number },
   *            confidence: number, lineId: number, blockId: number }[] }>}  Boxes in px of the image.
   */
  async recognize(image) {
    if (!worker) throw new Error('engine not initialised');
    const { data } = await worker.recognize(image, {}, { text: false, blocks: true });
    const words = [];
    let lineId = 0;
    let blockId = 0;
    for (const block of data.blocks || []) {
      for (const paragraph of block.paragraphs || []) {
        for (const line of paragraph.lines || []) {
          for (const word of line.words || []) {
            const { x0, y0, x1, y1 } = word.bbox;
            words.push({ text: word.text, bbox: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, confidence: word.confidence, lineId, blockId });
          }
          lineId++;
        }
        blockId++; // a paragraph is what the UI calls a block
      }
    }
    return { words };
  },

  async terminate() {
    const current = worker;
    worker = null;
    loaded = '';
    await current?.terminate();
  },

  /** Languages there is data for. */
  async listLanguages() {
    return [...BUNDLED_LANGUAGES];
  },

  /** Size of a language's data on disk, in bytes (0 if there is none). */
  async dataSize(language) {
    if (!BUNDLED_LANGUAGES.includes(language)) return 0;
    try {
      return (await (await fetch(`${BASE}lang/${language}.traineddata.gz`)).blob()).size;
    } catch {
      return 0;
    }
  },
};
