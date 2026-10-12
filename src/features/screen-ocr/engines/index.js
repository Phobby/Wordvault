// The engines behind "scan text on screen". Everything else in the feature talks to this
// interface and does not know which engine it has:
//
//   id                                   string
//   init(languages, onProgress)          Make ready for 'eng+tur'-style languages. onProgress
//                                        gets { stage: 'loading' | 'reading', progress: 0..1 }.
//   recognize(image, options)            → { words: [{ text, bbox: { x, y, width, height },
//                                            confidence (0-100), lineId, blockId }] }
//                                        `image` is a Blob; boxes are in pixels of that image.
//   terminate()                          Give back the memory.
//   listLanguages()                      → engine language codes there is data for
//   dataSize(language)                   → bytes
//
// There is no stand-in engine in the product. The one used by tests lives in tests/helpers.

import { tesseractEngine } from './tesseract.js';

const ENGINES = { [tesseractEngine.id]: tesseractEngine };

export const DEFAULT_ENGINE = tesseractEngine.id;

/** @param {string} [id] */
export function getEngine(id) {
  return ENGINES[id] || ENGINES[DEFAULT_ENGINE];
}

export const listEngines = () => Object.keys(ENGINES);
