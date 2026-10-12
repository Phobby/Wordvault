// Screen text scanning: the area the user drags, the mapping between the page and the
// screenshot, the grouping of what an engine finds, and the test-only stand-in engine.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { mockEngine } from './helpers/mock-engine.js';
import { createMapping, placeOnPage, wholeViewport } from '../src/features/screen-ocr/geometry.js';
import { captureErrorCode } from '../src/features/screen-ocr/scan.js';
import { loadScripts } from './helpers/hover.js';

const { ocrArea } = loadScripts(['features/screen-ocr/content/area.js']);
const plain = (value) => JSON.parse(JSON.stringify(value));
const near = (actual, expected, tolerance, label) => {
  for (const key of Object.keys(expected)) {
    assert.ok(Math.abs(actual[key] - expected[key]) <= tolerance, `${label || ''} ${key}: ${actual[key]} is not within ${tolerance} of ${expected[key]}`);
  }
};

// --- The mapping -----------------------------------------------------------------------------------

test('an ordinary screen: one image pixel per CSS pixel', () => {
  const mapping = createMapping({ width: 1280, height: 720 }, { innerWidth: 1280, innerHeight: 720 });
  assert.deepEqual([mapping.scaleX, mapping.scaleY], [1, 1]);
  assert.deepEqual(mapping.toImage({ x: 100, y: 50, width: 300, height: 80 }), { x: 100, y: 50, width: 300, height: 80 });
});

test('a high-density screen: the area is cut out at twice the size and boxes come back where they were', () => {
  const mapping = createMapping({ width: 2560, height: 1440 }, { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 2 });
  assert.equal(mapping.scaleX, 2);
  const crop = mapping.toImage({ x: 100, y: 50, width: 300, height: 80 });
  assert.deepEqual(crop, { x: 200, y: 100, width: 600, height: 160 });
  // a word found at (40, 20) of the crop, 120 by 36 image pixels
  assert.deepEqual(mapping.toPage({ x: 40, y: 20, width: 120, height: 36 }, crop), { x: 120, y: 60, width: 60, height: 18 });
});

for (const zoom of [0.5, 0.67, 0.8, 0.9, 1.1, 1.25, 1.5, 1.75, 2, 3]) {
  for (const density of [1, 2]) {
    test(`browser zoom ${zoom} on a ${density}x screen: a box goes to the picture and back to within a pixel`, () => {
      // Zooming changes how many CSS pixels the window holds; the picture stays the window's size.
      const picture = { width: 1440 * density, height: 900 * density };
      const viewport = { innerWidth: Math.round(1440 / zoom), innerHeight: Math.round(900 / zoom), devicePixelRatio: density * zoom };
      const mapping = createMapping(picture, viewport);
      near({ x: mapping.scaleX, y: mapping.scaleY }, { x: density * zoom, y: density * zoom }, 0.01 * density * zoom, 'scale');
      const area = { x: 37.5, y: 101.25, width: 333.3, height: 77.7 };
      const crop = mapping.toImage(area);
      for (const value of Object.values(crop)) assert.ok(Number.isInteger(value), 'the crop is whole pixels');
      // the crop holds the area and at most one pixel more on each side
      const back = mapping.toPage({ x: 0, y: 0, width: crop.width, height: crop.height }, crop);
      const pixel = 1 / mapping.scaleX;
      assert.ok(back.x <= area.x && back.y <= area.y && back.x + back.width >= area.x + area.width - 1e-9 && back.y + back.height >= area.y + area.height - 1e-9);
      near(back, area, 2 * pixel + 1e-9, 'area');
      // a word in the middle of the crop lands on the same page position it was drawn at
      const wordOnPage = { x: 150, y: 130, width: 64, height: 16 };
      const inCrop = { x: (wordOnPage.x - back.x) * mapping.scaleX, y: (wordOnPage.y - back.y) * mapping.scaleY, width: wordOnPage.width * mapping.scaleX, height: wordOnPage.height * mapping.scaleY };
      near(mapping.toPage(inCrop, crop), wordOnPage, 1e-6, 'word');
    });
  }
}

test('a picture whose size was rounded differently each way still maps exactly at its edges', () => {
  // 1333 x 751 CSS px at 1.5: the browser delivers 2000 x 1127, not 1999.5 x 1126.5
  const mapping = createMapping({ width: 2000, height: 1127 }, { innerWidth: 1333, innerHeight: 751 });
  assert.notEqual(mapping.scaleX, mapping.scaleY);
  assert.deepEqual(mapping.toImage({ x: 0, y: 0, width: 1333, height: 751 }), { x: 0, y: 0, width: 2000, height: 1127 });
});

test('pinched in: the picture shows a part of the viewport, starting at the visible offset', () => {
  const viewport = { innerWidth: 1000, innerHeight: 600, scale: 2, offsetLeft: 300, offsetTop: 120 };
  const mapping = createMapping({ width: 2000, height: 1200 }, viewport);
  assert.deepEqual(plain(mapping.visible), { x: 300, y: 120, width: 500, height: 300 });
  assert.equal(mapping.scaleX, 4);
  const crop = mapping.toImage({ x: 350, y: 150, width: 100, height: 50 });
  assert.deepEqual(crop, { x: 200, y: 120, width: 400, height: 200 });
  assert.deepEqual(mapping.toPage({ x: 0, y: 0, width: 400, height: 200 }, crop), { x: 350, y: 150, width: 100, height: 50 });
  assert.deepEqual(wholeViewport(viewport), { x: 300, y: 120, width: 500, height: 300 });
});

test('an area is cut down to the picture; one outside it is nothing', () => {
  const mapping = createMapping({ width: 800, height: 600 }, { innerWidth: 800, innerHeight: 600 });
  assert.deepEqual(mapping.toImage({ x: -50, y: 500, width: 200, height: 400 }), { x: 0, y: 500, width: 150, height: 100 });
  assert.equal(mapping.toImage({ x: 900, y: 0, width: 50, height: 50 }), null);
  assert.equal(mapping.toImage({ x: 10, y: 10, width: 0, height: 0 }), null);
  assert.throws(() => createMapping({ width: 0, height: 0 }, { innerWidth: 800, innerHeight: 600 }), RangeError);
});

test('a crop that was enlarged before reading maps back at its original size', () => {
  const mapping = createMapping({ width: 2000, height: 1000 }, { innerWidth: 1000, innerHeight: 500 });
  const crop = { x: 100, y: 100, width: 400, height: 200 };
  // read at 3x: a box at (300, 150) of the enlarged crop is at (100, 50) of the crop
  assert.deepEqual(mapping.toPage({ x: 300, y: 150, width: 90, height: 60 }, crop, 3), { x: 100, y: 75, width: 15, height: 10 });
});

// --- Words, lines, blocks ---------------------------------------------------------------------------

test('what an engine found is put on the page, grouped into lines and blocks', () => {
  const mapping = createMapping({ width: 2000, height: 1000 }, { innerWidth: 1000, innerHeight: 500 });
  const crop = { x: 200, y: 100, width: 800, height: 400 };
  const box = (x, y, width, height) => ({ x, y, width, height });
  const placed = placeOnPage(
    {
      words: [
        { text: 'Good', bbox: box(0, 0, 80, 30), confidence: 96, lineId: 0, blockId: 0 },
        { text: 'morning', bbox: box(100, 2, 140, 30), confidence: 91, lineId: 0, blockId: 0 },
        { text: 'everyone', bbox: box(0, 40, 160, 30), confidence: 88, lineId: 1, blockId: 0 },
        { text: 'Subscribe', bbox: box(400, 300, 180, 40), confidence: 70, lineId: 2, blockId: 1 },
      ],
    },
    mapping,
    crop,
  );
  assert.deepEqual(placed.words.map((word) => word.id), [0, 1, 2, 3]);
  assert.deepEqual(placed.words[1].rect, { x: 150, y: 51, width: 70, height: 15 });
  assert.deepEqual(placed.lines.map((line) => [line.id, line.text, line.words]), [
    [0, 'Good morning', [0, 1]],
    [1, 'everyone', [2]],
    [2, 'Subscribe', [3]],
  ]);
  assert.deepEqual(placed.lines[0].rect, { x: 100, y: 50, width: 120, height: 16 }, 'the box around the words of the line');
  assert.deepEqual(placed.blocks.map((block) => [block.id, block.text]), [
    [0, 'Good morning everyone'],
    [1, 'Subscribe'],
  ]);
  assert.deepEqual(placeOnPage({ words: [] }, mapping, crop), { words: [], lines: [], blocks: [] });
});

// --- The stand-in engine ----------------------------------------------------------------------------

/** A picture with rectangles of "ink" on a plain background. */
function picture(width, height, boxes, { background = 255, ink = 0 } = {}) {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let pixel = 0; pixel < width * height; pixel++) data.fill(background, pixel * 4, pixel * 4 + 3);
  for (const [x, y, w, h] of boxes) {
    for (let row = y; row < y + h; row++) {
      for (let column = x; column < x + w; column++) data.fill(ink, (row * width + column) * 4, (row * width + column) * 4 + 3);
    }
  }
  return { data, width, height };
}

test('the stand-in engine has the shape of an engine and finds where the ink is', async () => {
  for (const method of ['init', 'recognize', 'terminate', 'listLanguages', 'dataSize']) assert.equal(typeof mockEngine[method], 'function', method);
  // two lines; in the first, letters 3 px apart make words, 12 px apart separate them
  const letters = [[10, 10, 8, 20], [21, 10, 8, 20], [32, 10, 8, 20], [52, 10, 8, 20], [63, 10, 8, 20], [10, 40, 30, 20]];
  const found = await mockEngine.recognize(picture(120, 80, letters));
  assert.deepEqual(found.words.map((word) => [word.bbox.x, word.bbox.y, word.bbox.width, word.bbox.height, word.lineId, word.blockId]), [
    [10, 10, 30, 20, 0, 0],
    [52, 10, 19, 20, 0, 0],
    [10, 40, 30, 20, 1, 0],
  ]);
  assert.ok(found.words.every((word) => typeof word.text === 'string' && word.text.length > 0));
});

test('the stand-in engine: light text on a dark background, far-apart lines are separate blocks, specks are ignored', async () => {
  const found = await mockEngine.recognize(picture(100, 140, [[10, 10, 40, 16], [10, 100, 40, 16], [70, 60, 2, 2]], { background: 20, ink: 240 }));
  assert.deepEqual(found.words.map((word) => [word.bbox.y, word.lineId, word.blockId]), [
    [10, 0, 0],
    [100, 1, 1],
  ]);
  assert.deepEqual((await mockEngine.recognize(picture(50, 50, []))).words, [], 'an empty picture has no words');
});

// --- The area the user drags -------------------------------------------------------------------------

const BOUNDS = { width: 1000, height: 600 };

test('a drag in any direction makes the same box; it stops at the edge of the viewport', () => {
  assert.deepEqual(plain(ocrArea.fromDrag({ x: 100, y: 80 }, { x: 400, y: 300 }, BOUNDS)), { x: 100, y: 80, width: 300, height: 220 });
  assert.deepEqual(plain(ocrArea.fromDrag({ x: 400, y: 300 }, { x: 100, y: 80 }, BOUNDS)), { x: 100, y: 80, width: 300, height: 220 });
  assert.deepEqual(plain(ocrArea.fromDrag({ x: 900, y: 500 }, { x: 1400, y: 900 }, BOUNDS)), { x: 900, y: 500, width: 100, height: 100 });
  assert.equal(ocrArea.isUsable(ocrArea.fromDrag({ x: 100, y: 80 }, { x: 104, y: 300 }, BOUNDS)), false, 'a click or a sliver is not an area');
  assert.equal(ocrArea.isUsable(null), false);
});

test('edges and corners move on their own; the box never turns inside out or leaves the viewport', () => {
  const box = { x: 100, y: 100, width: 300, height: 200 };
  assert.deepEqual(plain(ocrArea.adjust(box, 'e', 50, 999, BOUNDS)), { x: 100, y: 100, width: 350, height: 200 });
  assert.deepEqual(plain(ocrArea.adjust(box, 'nw', -40, 30, BOUNDS)), { x: 60, y: 130, width: 340, height: 170 });
  assert.deepEqual(plain(ocrArea.adjust(box, 's', 0, 5000, BOUNDS)), { x: 100, y: 100, width: 300, height: 500 });
  const squeezed = ocrArea.adjust(box, 'w', 5000, 0, BOUNDS);
  assert.deepEqual(plain(squeezed), { x: 400 - ocrArea.MIN_SIZE, y: 100, width: ocrArea.MIN_SIZE, height: 200 });
  assert.deepEqual(plain(ocrArea.adjust(box, 'move', 5000, -5000, BOUNDS)), { x: 700, y: 0, width: 300, height: 200 });
});

test('a remembered area is fitted to the viewport as it is now, or dropped', () => {
  assert.deepEqual(plain(ocrArea.restore({ x: 100, y: 100, width: 300, height: 200 }, BOUNDS)), { x: 100, y: 100, width: 300, height: 200 });
  assert.deepEqual(plain(ocrArea.restore({ x: 900, y: 500, width: 300, height: 200 }, BOUNDS)), { x: 700, y: 400, width: 300, height: 200 });
  assert.deepEqual(plain(ocrArea.restore({ x: 0, y: 0, width: 3000, height: 2000 }, BOUNDS)), { x: 0, y: 0, width: 1000, height: 600 });
  assert.equal(ocrArea.restore(null, BOUNDS), null);
  assert.equal(ocrArea.restore({ x: 'a', y: 0, width: 10, height: 10 }, BOUNDS), null);
  assert.equal(ocrArea.restore({ x: 0, y: 0, width: 3, height: 3 }, BOUNDS), null);
});

// --- Capture errors ---------------------------------------------------------------------------------

test('what the browsers say when a capture fails is told apart', () => {
  assert.equal(captureErrorCode('This request exceeds the MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota.'), 'ocr_rate');
  assert.equal(captureErrorCode("Either the '<all_urls>' or 'activeTab' permission is required."), 'ocr_forbidden');
  assert.equal(captureErrorCode('Missing activeTab permission'), 'ocr_forbidden');
  assert.equal(captureErrorCode('Cannot access contents of the page. Extension manifest must request permission to access the respective host.'), 'ocr_forbidden');
  assert.equal(captureErrorCode('The extensions gallery cannot be scripted.'), 'ocr_forbidden');
  assert.equal(captureErrorCode('Failed to capture tab: image readback failed'), 'ocr_capture');
  assert.equal(captureErrorCode(undefined), 'ocr_capture');
});
