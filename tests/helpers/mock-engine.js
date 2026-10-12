// TEST ONLY. A stand-in for a text recognition engine. It cannot read: it finds where the ink is (rows of
// it, and runs within a row) and calls each run a word with a made-up text. That is enough to
// build and check everything around an engine (capture, cropping, the mapping of boxes back
// onto the page, the text layer) before a real one is in place. It has the shape every engine
// has; see engines/ for the real ones.

/** A pixel is ink when it is this far (0-255) from the background's brightness. */
const INK_DISTANCE = 56;
/** Rows of ink lower than this are specks, not text. */
const MIN_LINE_HEIGHT = 5;
/** A gap this wide, in line heights, separates two words. */
const WORD_GAP = 0.3;
/** A gap this tall, in line heights, starts a new block. */
const BLOCK_GAP = 1.2;

const luminance = (data, index) => 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2];

/** The brightness most of the border has: text does not usually touch the edge of a selection. */
function backgroundOf({ data, width, height }) {
  const counts = new Uint32Array(32);
  const sample = (x, y) => counts[Math.min(31, Math.floor(luminance(data, (y * width + x) * 4) / 8))]++;
  for (let x = 0; x < width; x++) {
    sample(x, 0);
    sample(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    sample(0, y);
    sample(width - 1, y);
  }
  return counts.indexOf(Math.max(...counts)) * 8 + 4;
}

/** Runs of consecutive true values: [start, end) pairs. */
function runs(flags) {
  const found = [];
  let start = -1;
  for (let index = 0; index <= flags.length; index++) {
    const on = index < flags.length && flags[index];
    if (on && start < 0) start = index;
    if (!on && start >= 0) {
      found.push([start, index]);
      start = -1;
    }
  }
  return found;
}

export const mockEngine = {
  id: 'mock',
  async init(lang, onProgress = () => {}) {
    onProgress({ status: 'ready', progress: 1 });
  },
  /**
   * @param {{ data: Uint8ClampedArray, width: number, height: number }} image  RGBA pixels.
   * @returns {Promise<{ words: { text: string, bbox: { x: number, y: number, width: number, height: number },
   *            confidence: number, lineId: number, blockId: number }[] }>}
   */
  async recognize(image) {
    const { data, width, height } = image;
    const background = backgroundOf(image);
    const ink = new Uint8Array(width * height);
    for (let pixel = 0; pixel < ink.length; pixel++) {
      ink[pixel] = Math.abs(luminance(data, pixel * 4) - background) > INK_DISTANCE ? 1 : 0;
    }

    const rowHasInk = new Array(height).fill(false);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (ink[y * width + x]) {
          rowHasInk[y] = true;
          break;
        }
      }
    }

    const words = [];
    let blockId = 0;
    let lineId = 0;
    let previousBottom = -1;
    for (const [top, bottom] of runs(rowHasInk)) {
      const lineHeight = bottom - top;
      if (lineHeight < MIN_LINE_HEIGHT) continue;
      if (previousBottom >= 0 && top - previousBottom > lineHeight * BLOCK_GAP) blockId++;
      previousBottom = bottom;

      const columnHasInk = new Array(width).fill(false);
      for (let x = 0; x < width; x++) {
        for (let y = top; y < bottom; y++) {
          if (ink[y * width + x]) {
            columnHasInk[x] = true;
            break;
          }
        }
      }
      // Letters of a word are closer together than words are.
      const gap = Math.max(2, Math.round(lineHeight * WORD_GAP));
      const merged = [];
      for (const [left, right] of runs(columnHasInk)) {
        const last = merged[merged.length - 1];
        if (last && left - last[1] < gap) last[1] = right;
        else merged.push([left, right]);
      }
      for (const [left, right] of merged) {
        words.push({
          text: `word${words.length + 1}`,
          bbox: { x: left, y: top, width: right - left, height: lineHeight },
          confidence: 0,
          lineId,
          blockId,
        });
      }
      lineId++;
    }
    return { words };
  },
  async terminate() {},
  async listLanguages() {
    return [];
  },
  async dataSize() {
    return 0;
  },
};
