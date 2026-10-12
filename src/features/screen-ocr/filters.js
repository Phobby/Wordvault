// Telling words from what an engine merely believes to be words. A screen is full of things
// that are not text (icons, a "more" button's three dots, thumbnails, borders), and an engine
// asked to read them answers with something. These rules decide what is shown.

export const DEFAULT_MIN_CONFIDENCE = 60;
/** Text lower than this (CSS px) cannot be read reliably and is usually a speck. */
const MIN_HEIGHT = 6;
const MIN_WIDTH = 3;
/** A box may be this many times wider than tall per character before it is a shape, not a word. */
const MAX_WIDTH_PER_CHAR = 2.6;
/** ... and this many times taller than wide (a vertical bar read as "l" or "|"). */
const MAX_HEIGHT_PER_WIDTH = 5;
/** A lone letter is only believed with this much more confidence than the threshold, and in company. */
const SINGLE_EXTRA_CONFIDENCE = 20;
const SINGLE_MIN_NEIGHBOURS = 2;
/** Two letters with nothing else on their line ("ak", "it" read off a bar) need this much more. */
const PAIR_EXTRA_CONFIDENCE = 30;

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
const LETTER = /\p{L}/u;
/** Scripts in which one character is a word. */
const ONE_CHAR_WORDS = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/** The text without the punctuation an engine attaches to it: what would be looked up. */
export const coreText = (text) => String(text || '').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

/**
 * Why a word is not shown; '' if it is.
 * @param {{ text: string, confidence: number, bbox: { width: number, height: number } }} word
 * @param {{ minConfidence?: number, pixelsPerCss?: number }} [options]
 *        pixelsPerCss: how many pixels of the picture the engine read are one CSS pixel.
 * @returns {'' | 'symbol' | 'confidence' | 'small' | 'shape'}
 */
export function rejectReason(word, { minConfidence = DEFAULT_MIN_CONFIDENCE, pixelsPerCss = 1 } = {}) {
  const text = coreText(word.text);
  if (!LETTER_OR_DIGIT.test(text)) return 'symbol'; // dots, dashes, arrows, bullets
  if (!(word.confidence >= minConfidence)) return 'confidence';
  const width = word.bbox.width / pixelsPerCss;
  const height = word.bbox.height / pixelsPerCss;
  if (height < MIN_HEIGHT || width < MIN_WIDTH) return 'small';
  const characters = [...text].length;
  if (width > height * MAX_WIDTH_PER_CHAR * characters) return 'shape';
  if (height > width * MAX_HEIGHT_PER_WIDTH) return 'shape';
  return '';
}

/**
 * The words worth showing.
 * @param {Object[]} words  Engine output (text, bbox, confidence, lineId, blockId).
 * @param {{ minConfidence?: number, pixelsPerCss?: number }} [options]
 * @returns {{ kept: Object[], dropped: Record<string, number> }}
 */
export function filterWords(words, options = {}) {
  const minConfidence = options.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  const dropped = {};
  const drop = (reason) => {
    dropped[reason] = (dropped[reason] || 0) + 1;
  };
  let kept = [];
  for (const word of words) {
    const reason = rejectReason(word, { ...options, minConfidence });
    if (reason) drop(reason);
    else kept.push(word);
  }

  // Very short "words" are what an engine makes of icons, bars and specks. A single character
  // on its own is nearly always one of those ("o", "x", "I" for a bar); in a line of words it
  // is a word ("I have a dog") if the engine is sure of it. Two characters alone on their line
  // ("OK" on a button, but also "ak" read off a rectangle) have to be read with high confidence.
  const perLine = new Map();
  for (const word of kept) perLine.set(word.lineId, (perLine.get(word.lineId) || 0) + 1);
  kept = kept.filter((word) => {
    const text = coreText(word.text);
    const characters = [...text].length;
    if (characters > 2 || ONE_CHAR_WORDS.test(text)) return true;
    const neighbours = perLine.get(word.lineId) - 1;
    const believable =
      characters === 1
        ? LETTER.test(text) && word.confidence >= minConfidence + SINGLE_EXTRA_CONFIDENCE && neighbours >= SINGLE_MIN_NEIGHBOURS
        : neighbours >= 1 || word.confidence >= minConfidence + PAIR_EXTRA_CONFIDENCE;
    if (!believable) drop('short');
    return believable;
  });
  return { kept, dropped };
}

const boxAround = (words) => {
  const left = Math.min(...words.map((word) => word.bbox.x));
  const top = Math.min(...words.map((word) => word.bbox.y));
  return { x: left, y: top, width: Math.max(...words.map((word) => word.bbox.x + word.bbox.width)) - left, height: Math.max(...words.map((word) => word.bbox.y + word.bbox.height)) - top };
};

/** How much of the smaller of two boxes lies inside the other (0..1). */
function overlap(a, b) {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  if (width <= 0 || height <= 0) return 0;
  return (width * height) / Math.max(1, Math.min(a.width * a.height, b.width * b.height));
}

function linesOf(words) {
  const lines = new Map();
  for (const word of words) {
    if (!lines.has(word.lineId)) lines.set(word.lineId, []);
    lines.get(word.lineId).push(word);
  }
  return [...lines.values()].map((members) => ({ words: members, box: boxAround(members), score: members.reduce((sum, word) => sum + word.confidence, 0) }));
}

/**
 * Two readings of the same picture (prepared in two ways) as one. Where both found a line in
 * the same place, the better reading of that line wins whole: more words the engine is sure
 * of. Lines only one of them found are all kept. Line and block numbers are made unique.
 *
 * @param {Object[]} first   Words of one reading, already filtered.
 * @param {Object[]} second
 * @returns {Object[]}
 */
export function mergeReadings(first, second) {
  let lines = linesOf(first);
  for (const candidate of linesOf(second)) {
    const rivals = lines.filter((line) => overlap(line.box, candidate.box) > 0.3);
    if (rivals.length > 0 && candidate.score <= rivals.reduce((sum, line) => sum + line.score, 0)) continue;
    lines = lines.filter((line) => !rivals.includes(line));
    lines.push({ ...candidate, second: true });
  }
  const blockOffset = first.reduce((max, word) => Math.max(max, word.blockId + 1), 0);
  // reading order: top to bottom, then left to right
  lines.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
  return lines.flatMap((line, lineId) => line.words.map((word) => ({ ...word, lineId, blockId: line.second ? word.blockId + blockOffset : word.blockId })));
}

/** Average confidence of a set of words (0 when there are none): how well a reading went. */
export function meanConfidence(words) {
  return words.length ? words.reduce((sum, word) => sum + word.confidence, 0) / words.length : 0;
}
