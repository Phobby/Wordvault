// Screen text scanning: what is shown of an engine's output (filters), how two readings of a
// picture become one, how a picture is prepared, and the language codes.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';

import { DEFAULT_MIN_CONFIDENCE, coreText, filterWords, meanConfidence, mergeReadings, rejectReason } from '../src/features/screen-ocr/filters.js';
import { BUNDLED_LANGUAGES, engineCode, languageTag, resolveLanguages, singleLanguageTag } from '../src/features/screen-ocr/languages.js';
import { PROFILES, blankKind, brightnessStats, chooseEnlargement, chooseProfiles, darkOnLight, darkShare, stretchContrast, toGray } from '../src/features/screen-ocr/preprocess.js';

const word = (text, confidence, [x, y, width, height], lineId = 0, blockId = 0) => ({ text, confidence, bbox: { x, y, width, height }, lineId, blockId });
const texts = (words) => words.map((item) => item.text);

// --- Filters ----------------------------------------------------------------------------------------

test('a word the engine is unsure of is left out; the threshold can be changed', () => {
  assert.equal(DEFAULT_MIN_CONFIDENCE, 60);
  assert.equal(rejectReason(word('subtitle', 59, [0, 0, 80, 16])), 'confidence');
  assert.equal(rejectReason(word('subtitle', 60, [0, 0, 80, 16])), '');
  assert.equal(rejectReason(word('subtitle', 59, [0, 0, 80, 16]), { minConfidence: 40 }), '');
  assert.equal(rejectReason(word('subtitle', 80, [0, 0, 80, 16]), { minConfidence: 90 }), 'confidence');
  assert.equal(rejectReason(word('subtitle', NaN, [0, 0, 80, 16])), 'confidence');
});

test('dots, dashes and other symbols are not words, however sure the engine is', () => {
  for (const text of ['...', '⋮', '•••', '—', '|', '>>', '♪', '©', '', '  ']) {
    assert.equal(rejectReason(word(text, 95, [0, 0, 20, 16])), 'symbol', JSON.stringify(text));
  }
  assert.equal(rejectReason(word('2024', 90, [0, 0, 40, 16])), '', 'numbers are kept');
  assert.equal(coreText('"hello,"'), 'hello');
  assert.equal(coreText('dog.'), 'dog');
  assert.equal(coreText('...'), '');
});

test('boxes too small to be text, and shapes that are not word-shaped, are left out', () => {
  assert.equal(rejectReason(word('ok', 90, [0, 0, 12, 5])), 'small', 'a three-dot button is a few pixels high');
  assert.equal(rejectReason(word('il', 90, [0, 0, 2, 16])), 'small');
  // sizes are judged in CSS pixels: the same box read from a picture enlarged 3x on a 2x screen
  assert.equal(rejectReason(word('ok', 90, [0, 0, 72, 30]), { pixelsPerCss: 6 }), 'small');
  assert.equal(rejectReason(word('ok', 90, [0, 0, 72, 60]), { pixelsPerCss: 6 }), '');
  assert.equal(rejectReason(word('Hi', 90, [0, 0, 160, 20])), 'shape', 'a thumbnail read as two letters: far too wide for them');
  assert.equal(rejectReason(word('ll', 90, [0, 0, 6, 60])), 'shape', 'a vertical bar');
  assert.equal(rejectReason(word('thumbnail', 90, [0, 0, 160, 20])), '', 'nine letters do fill a box that wide');
});

test('a single character is a word only in a line of words, and only when the engine is sure', () => {
  const line = [word('I', 92, [0, 0, 6, 16]), word('have', 90, [12, 0, 40, 16]), word('a', 91, [58, 0, 9, 16]), word('dog', 90, [72, 0, 30, 16])];
  assert.deepEqual(texts(filterWords(line).kept), ['I', 'have', 'a', 'dog']);
  const alone = filterWords([word('o', 95, [0, 0, 14, 14], 3), word('x', 95, [300, 200, 12, 12], 4)]);
  assert.deepEqual(alone.kept, []);
  assert.deepEqual(alone.dropped, { short: 2 });
  const unsure = [word('I', 70, [0, 0, 6, 16]), word('have', 90, [12, 0, 40, 16]), word('dogs', 90, [60, 0, 40, 16])];
  assert.deepEqual(texts(filterWords(unsure).kept), ['have', 'dogs'], 'at 70 a lone letter is not believed');
  assert.deepEqual(texts(filterWords([word('私', 80, [0, 0, 16, 16])]).kept), ['私'], 'where one character is a word, it is kept');
});

test('two letters alone on their line need high confidence; with company they are a word', () => {
  assert.deepEqual(filterWords([word('ak', 75, [0, 0, 24, 16])]).kept, [], '"ak" read off a black bar');
  assert.deepEqual(texts(filterWords([word('OK', 93, [0, 0, 24, 16])]).kept), ['OK'], 'a button that really says OK');
  assert.deepEqual(texts(filterWords([word('we', 70, [0, 0, 24, 16]), word('should', 80, [30, 0, 60, 16])]).kept), ['we', 'should']);
});

test('what was dropped is counted by reason', () => {
  const result = filterWords([word('good', 90, [0, 0, 40, 16]), word('...', 90, [50, 0, 12, 4]), word('blur', 20, [0, 30, 40, 16], 1), word('Hi', 90, [0, 60, 300, 20], 2)]);
  assert.deepEqual(texts(result.kept), ['good']);
  assert.deepEqual(result.dropped, { symbol: 1, confidence: 1, shape: 1 });
  assert.equal(meanConfidence(result.kept), 90);
  assert.equal(meanConfidence([]), 0);
});

// --- Two readings of one picture ----------------------------------------------------------------------

test('where two readings found the same line, the better one wins whole', () => {
  // the caption as the page reading sees it (the picture bleeds in) and as the caption reading does
  const page = [word('The', 90, [0, 0, 30, 16], 0), word('fox', 90, [36, 0, 30, 16], 0), word("leave'before'", 62, [100, 200, 180, 30], 1)];
  const film = [word('we', 85, [20, 200, 30, 30], 0), word('should', 88, [56, 200, 80, 30], 0), word('leave', 90, [142, 200, 60, 30], 0), word('before', 91, [208, 200, 72, 30], 0)];
  const merged = mergeReadings(page, film);
  assert.deepEqual(texts(merged), ['The', 'fox', 'we', 'should', 'leave', 'before']);
  assert.deepEqual(merged.map((item) => item.lineId), [0, 0, 1, 1, 1, 1], 'lines are numbered top to bottom');
  assert.notEqual(merged[2].blockId, merged[0].blockId, 'blocks of the second reading do not collide with the first');
});

test('a second reading that is worse changes nothing; lines only it found are added', () => {
  const page = [word('Light', 90, [0, 0, 50, 20], 0), word('text', 90, [56, 0, 40, 20], 0)];
  const film = [word('Lght', 61, [0, 0, 50, 20], 0), word('BAKERY', 88, [0, 100, 90, 24], 1)];
  assert.deepEqual(texts(mergeReadings(page, film)), ['Light', 'text', 'BAKERY']);
  assert.deepEqual(mergeReadings([], []), []);
  assert.deepEqual(texts(mergeReadings([], film)), ['Lght', 'BAKERY']);
});

// --- Preparing the picture ----------------------------------------------------------------------------

/** A picture of one colour with rectangles of another. */
function picture(width, height, background, boxes = []) {
  const data = new Uint8ClampedArray(width * height * 4);
  const paint = (x, y, [r, g, b]) => data.set([r, g, b, 255], (y * width + x) * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) paint(x, y, background);
  for (const [x0, y0, w, h, colour] of boxes) for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) paint(x, y, colour);
  return { data, width, height };
}
const WHITE = [255, 255, 255];
const BLACK = [0, 0, 0];
const grayAt = (image, x, y) => image.data[(y * image.width + x) * 4];

test('small text is enlarged, dense screens less, large areas less still', () => {
  assert.equal(chooseEnlargement(1, 400, 200), 3, 'an ordinary screen: three times');
  assert.equal(chooseEnlargement(2, 800, 400), 1.5, 'a dense screen already has twice the pixels');
  assert.equal(chooseEnlargement(3, 800, 400), 1);
  assert.equal(chooseEnlargement(4, 800, 400), 1, 'never made smaller');
  const whole = chooseEnlargement(1, 1920, 1080);
  assert.ok(whole >= 1 && whole < 3 && 1920 * 1080 * whole * whole <= 6_000_000, `a whole screen is capped by its area: ${whole}`);
  assert.equal(whole * 4, Math.round(whole * 4), 'in quarter steps');
});

test('a black picture is told apart from a flat one and from one with something in it', () => {
  assert.equal(blankKind(toGray(picture(40, 30, BLACK))), 'black', 'what a protected video gives');
  assert.equal(blankKind(toGray(picture(40, 30, [3, 3, 3]))), 'black');
  assert.equal(blankKind(toGray(picture(40, 30, WHITE))), 'flat');
  assert.equal(blankKind(toGray(picture(40, 30, [120, 120, 120]))), 'flat');
  assert.equal(blankKind(toGray(picture(40, 30, BLACK, [[5, 5, 20, 8, WHITE]]))), '', 'a dark film frame with a caption is not blank');
  const stats = brightnessStats(toGray(picture(10, 10, [100, 100, 100])));
  assert.deepEqual([Math.round(stats.mean), Math.round(stats.deviation)], [100, 0]);
});

test('contrast is spread out: grey on grey becomes black on white', () => {
  const image = picture(40, 20, [150, 150, 150], [[4, 4, 20, 10, [110, 110, 110]]]);
  const stretched = stretchContrast(toGray(image));
  assert.equal(stretched[0], 255);
  assert.equal(stretched[5 * 40 + 6], 0);
  const flat = toGray(picture(10, 10, [80, 80, 80]));
  assert.deepEqual([...stretchContrast(flat)], [...flat], 'a flat picture is left as it is');
});

test('the plain and the inverted profile keep the size and turn the picture over', () => {
  const image = picture(60, 40, BLACK, [[10, 10, 30, 12, WHITE]]);
  const plain = PROFILES.standard(image);
  const inverted = PROFILES.inverted(image);
  assert.deepEqual([plain.width, plain.height, plain.data.length], [60, 40, 60 * 40 * 4]);
  assert.deepEqual([grayAt(plain, 0, 0), grayAt(plain, 15, 15)], [0, 255]);
  assert.deepEqual([grayAt(inverted, 0, 0), grayAt(inverted, 15, 15)], [255, 0], 'light text on dark is now dark on light');
  assert.equal(image.data[0], 0, 'the picture that was given is not changed');
});

test('a dark banner on a light page is turned over on its own', () => {
  // light page, a dark banner across the middle with light "text" in it, dark "text" above it
  const width = 160;
  const height = 120;
  const image = picture(width, height, WHITE, [[20, 10, 40, 8, BLACK], [0, 48, width, 48, [20, 20, 20]], [30, 66, 60, 10, WHITE]]);
  const gray = toGray(image);
  const out = darkOnLight(gray, width, height);
  const at = (x, y) => out[y * width + x];
  assert.equal(at(5, 5), 255, 'the page stays light');
  assert.equal(at(30, 13), 0, 'dark text on it stays dark');
  assert.equal(at(100, 70), 235, 'the banner is light now');
  assert.equal(at(40, 70), 0, 'and its text dark');
  assert.equal(gray[70 * width + 40], 255, 'the input is left alone');
  assert.deepEqual([...darkOnLight(toGray(picture(32, 32, WHITE)), 32, 32)], [...toGray(picture(32, 32, WHITE))]);
});

test('the caption profile keeps only what is nearly white', () => {
  // a busy picture, a white caption with a black outline, a bright but coloured patch
  const image = picture(80, 40, [120, 170, 150], [[10, 10, 40, 14, BLACK], [12, 12, 36, 10, WHITE], [60, 5, 12, 12, [238, 221, 170]]]);
  const out = PROFILES.subtitle(image);
  assert.equal(grayAt(out, 20, 16), 0, 'the caption fill is the text');
  assert.equal(grayAt(out, 10, 10), 255, 'its outline is background');
  assert.equal(grayAt(out, 2, 2), 255, 'so is the picture');
  assert.equal(grayAt(out, 64, 8), 255, 'and anything bright that has a colour');
});

test('which readings a picture gets depends on how dark it is', () => {
  const light = toGray(picture(100, 100, WHITE, [[10, 10, 10, 10, BLACK]]));
  assert.equal(Math.round(darkShare(light) * 100), 1);
  assert.deepEqual(chooseProfiles(light), ['standard', 'subtitle'], 'a light page: no reading for dark parts');
  const mixed = toGray(picture(100, 100, WHITE, [[0, 60, 100, 20, BLACK]]));
  assert.deepEqual(chooseProfiles(mixed), ['standard', 'local', 'subtitle']);
  const darkPage = toGray(picture(100, 100, [15, 15, 15], [[10, 10, 30, 5, WHITE]]));
  assert.deepEqual(chooseProfiles(darkPage), ['inverted', 'local', 'subtitle']);
  for (const list of [chooseProfiles(light), chooseProfiles(mixed), chooseProfiles(darkPage)]) for (const name of list) assert.equal(typeof PROFILES[name], 'function', name);
});

// --- Languages ----------------------------------------------------------------------------------------

test('language tags map onto the engine codes there is data for', () => {
  assert.equal(engineCode('en'), 'eng');
  assert.equal(engineCode('en-GB'), 'eng');
  assert.equal(engineCode('TR'), 'tur');
  assert.equal(engineCode('de'), '', 'no data shipped for German');
  assert.equal(engineCode(''), '');
  assert.equal(languageTag('tur'), 'tr');
  assert.equal(languageTag('xyz'), '');
});

test('"automatic" reads with every bundled language; a choice narrows it', () => {
  assert.deepEqual([...BUNDLED_LANGUAGES], ['eng', 'tur']);
  assert.equal(resolveLanguages('auto'), 'eng+tur');
  assert.equal(resolveLanguages(undefined), 'eng+tur');
  assert.equal(resolveLanguages('tr'), 'tur');
  assert.equal(resolveLanguages(['en', 'tr', 'en']), 'eng+tur');
  assert.equal(resolveLanguages('eng+tur'), 'eng+tur');
  assert.equal(resolveLanguages('de'), 'eng+tur', 'a language without data falls back to all of them');
  assert.equal(singleLanguageTag('tur'), 'tr');
  assert.equal(singleLanguageTag('eng+tur'), '', 'read with several: the line decides the language');
});

// --- What is shipped ----------------------------------------------------------------------------------

test('no stand-in engine in the product, and the engine files are the ones the checksums name', async () => {
  const engines = readdirSync(new URL('../src/features/screen-ocr/engines/', import.meta.url));
  assert.deepEqual(engines.sort(), ['index.js', 'tesseract.js']);
  const source = readdirSync(new URL('../src/features/screen-ocr/', import.meta.url), { recursive: true })
    .filter((file) => String(file).endsWith('.js'))
    .map((file) => readFileSync(new URL(`../src/features/screen-ocr/${file}`, import.meta.url), 'utf8'))
    .join('\n');
  assert.ok(!/mockEngine|mock-engine|engines\/mock/.test(source), 'nothing in the feature refers to the test engine');

  const { createHash } = await import('node:crypto');
  const readme = readFileSync(new URL('../src/vendor/tesseract/README.md', import.meta.url), 'utf8');
  const sums = [...readme.matchAll(/^([0-9a-f]{64}) {2}(\S+)$/gm)];
  assert.equal(sums.length, 7);
  for (const [, sum, file] of sums) {
    const actual = createHash('sha256').update(readFileSync(new URL(`../src/vendor/tesseract/${file}`, import.meta.url))).digest('hex');
    assert.equal(actual, sum, `${file} is not the file that was vendored`);
  }
  for (const language of BUNDLED_LANGUAGES) assert.ok(sums.some(([, , file]) => file === `lang/${language}.traineddata.gz`), language);
});
