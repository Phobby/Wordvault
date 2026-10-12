// Getting a piece of a screenshot ready for text recognition. Engines read dark text on a light
// background at a comfortable size best; a screen has anything but. Everything here works on
// plain pixel arrays ({ data: RGBA, width, height }), so it is independent of the engine and
// can be tested without a browser.

/** Text should be about this many image pixels per CSS pixel when it is read (≈ 30 px capitals for 12 px text). */
const TARGET_PIXELS_PER_CSS = 3;
const MAX_ENLARGEMENT = 3;
/** Larger pictures than this are read at a smaller enlargement: time and memory grow with the area. */
const MAX_PIXELS = 6_000_000;

const luminance = (data, index) => 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2];

/**
 * How many times to enlarge a crop before reading it.
 * @param {number} pixelsPerCss  Image pixels per CSS pixel in the screenshot (2 on a dense screen).
 * @param {number} width   Size of the crop, image px.
 * @param {number} height
 * @returns {number} Between 1 and 3, in quarter steps.
 */
export function chooseEnlargement(pixelsPerCss, width, height) {
  const wanted = Math.min(MAX_ENLARGEMENT, Math.max(1, TARGET_PIXELS_PER_CSS / pixelsPerCss));
  const allowed = Math.sqrt(MAX_PIXELS / Math.max(1, width * height));
  return Math.max(1, Math.floor(Math.min(wanted, allowed) * 4) / 4);
}

/** Brightness of every pixel, 0-255. */
export function toGray({ data, width, height }) {
  const gray = new Uint8ClampedArray(width * height);
  for (let pixel = 0; pixel < gray.length; pixel++) gray[pixel] = luminance(data, pixel * 4);
  return gray;
}

/** @returns {{ mean: number, deviation: number }} of the brightness. */
export function brightnessStats(gray) {
  let sum = 0;
  let squares = 0;
  for (const value of gray) {
    sum += value;
    squares += value * value;
  }
  const mean = gray.length ? sum / gray.length : 0;
  return { mean, deviation: Math.sqrt(Math.max(0, (gray.length ? squares / gray.length : 0) - mean * mean)) };
}

/**
 * A picture with nothing in it: one flat colour. A black one is what a browser hands out for
 * video it is not allowed to show in screenshots (protected content).
 * @returns {'' | 'black' | 'flat'}
 */
export function blankKind(gray) {
  const { mean, deviation } = brightnessStats(gray);
  if (deviation >= 2.5) return '';
  return mean < 12 ? 'black' : 'flat';
}

/** The brightness below which `fraction` of the pixels lie. */
function percentile(histogram, total, fraction) {
  let seen = 0;
  for (let value = 0; value < 256; value++) {
    seen += histogram[value];
    if (seen >= total * fraction) return value;
  }
  return 255;
}

/** Spreads the brightness actually used over the whole range: grey on grey becomes black on white. */
export function stretchContrast(gray) {
  const histogram = new Uint32Array(256);
  for (const value of gray) histogram[value]++;
  const low = percentile(histogram, gray.length, 0.01);
  const high = percentile(histogram, gray.length, 0.99);
  if (high - low < 8) return gray.slice(); // flat: nothing to spread
  const out = new Uint8ClampedArray(gray.length);
  const factor = 255 / (high - low);
  for (let pixel = 0; pixel < gray.length; pixel++) out[pixel] = (gray[pixel] - low) * factor;
  return out;
}

/** Share of the picture that is dark (0..1). */
export function darkShare(gray) {
  let dark = 0;
  for (const value of gray) if (value < 128) dark++;
  return gray.length ? dark / gray.length : 0;
}

/** The picture is turned square by square; squares this small follow the edge of a banner closely. */
const POLARITY_TILE = 8;
/** ... but each is judged with its surroundings (this many squares each way): a letter's stroke is not a background. */
const POLARITY_REACH = 3;

/**
 * Makes the text dark on light everywhere. A screen mixes both (a dark banner on a light page,
 * a light card on a dark one), so the background is judged locally: where most of the
 * neighbourhood of a square is dark, the light part is the text, and the square is inverted.
 * @returns {Uint8ClampedArray} A new array; `gray` is left alone.
 */
export function darkOnLight(gray, width, height, tile = POLARITY_TILE, reach = POLARITY_REACH) {
  const columns = Math.ceil(width / tile);
  const rows = Math.ceil(height / tile);
  const dark = new Float64Array(columns * rows);
  const size = new Float64Array(columns * rows);
  for (let y = 0; y < height; y++) {
    const row = Math.floor(y / tile) * columns;
    for (let x = 0; x < width; x++) {
      const cell = row + Math.floor(x / tile);
      size[cell]++;
      if (gray[y * width + x] < 128) dark[cell]++;
    }
  }
  const out = gray.slice();
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      let darkAround = 0;
      let sizeAround = 0;
      for (let r = Math.max(0, row - reach); r <= Math.min(rows - 1, row + reach); r++) {
        for (let c = Math.max(0, column - reach); c <= Math.min(columns - 1, column + reach); c++) {
          darkAround += dark[r * columns + c];
          sizeAround += size[r * columns + c];
        }
      }
      if (darkAround * 2 <= sizeAround) continue;
      const bottom = Math.min(height, (row + 1) * tile);
      const right = Math.min(width, (column + 1) * tile);
      for (let y = row * tile; y < bottom; y++) {
        for (let x = column * tile; x < right; x++) out[y * width + x] = 255 - gray[y * width + x];
      }
    }
  }
  return out;
}

function fromGray(gray, width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let pixel = 0; pixel < gray.length; pixel++) {
    const index = pixel * 4;
    data[index] = data[index + 1] = data[index + 2] = gray[pixel];
    data[index + 3] = 255;
  }
  return { data, width, height };
}

/**
 * The profiles. Each takes a picture and returns the picture the engine should read.
 *   standard  Grey with the contrast spread out. Reads dark text on light.
 *   inverted  The same, turned over: for a dark page or a dark player, whose light text is
 *             then dark on light.
 *   local     Turned over only where the surroundings are dark: for a picture that mixes both
 *             (a dark banner on a light page). Leaves a seam where the two meet, which is why
 *             it is an additional reading and not the only one.
 *   subtitle  For white text with a dark outline or shadow over a moving picture: only what is
 *             nearly white stays (as black on white); the picture behind it is thrown away.
 */
export const PROFILES = {
  standard(image) {
    return fromGray(stretchContrast(toGray(image)), image.width, image.height);
  },
  inverted(image) {
    const gray = stretchContrast(toGray(image));
    for (let pixel = 0; pixel < gray.length; pixel++) gray[pixel] = 255 - gray[pixel];
    return fromGray(gray, image.width, image.height);
  },
  local(image) {
    const gray = stretchContrast(toGray(image));
    return fromGray(darkOnLight(gray, image.width, image.height), image.width, image.height);
  },
  subtitle(image) {
    const { data, width, height } = image;
    const gray = new Uint8ClampedArray(width * height);
    for (let pixel = 0; pixel < gray.length; pixel++) {
      const index = pixel * 4;
      const max = Math.max(data[index], data[index + 1], data[index + 2]);
      const min = Math.min(data[index], data[index + 1], data[index + 2]);
      // bright and colourless: the caption's fill. Everything else is background.
      gray[pixel] = min >= 190 && max - min <= 40 ? 0 : 255;
    }
    return fromGray(gray, width, height);
  },
};

/** A picture with less dark in it than this has no dark region worth a reading of its own. */
const MIN_DARK_SHARE = 0.03;

/**
 * Which readings a picture gets, in order.
 * @param {Uint8ClampedArray} gray  Its brightness.
 * @returns {string[]} Profile names.
 */
export function chooseProfiles(gray) {
  const dark = darkShare(gray);
  // ASSUMPTION: measured on the test page in both browsers, neither the plain nor the locally
  // turned reading finds light-on-dark text every time; together they did. Hence both.
  if (dark > 0.5) return ['inverted', 'local', 'subtitle'];
  return dark >= MIN_DARK_SHARE ? ['standard', 'local', 'subtitle'] : ['standard', 'subtitle'];
}
