// Scanning: picking a part of the page by pointing at it (as the browser's screenshot tool
// does), and the colours of a block a translation is written over.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { blockColours } from '../src/features/screen-ocr/colours.js';
import { loadScripts } from './helpers/hover.js';

const { ocrArea } = loadScripts(['features/screen-ocr/content/area.js']);
const VIEWPORT = { width: 1000, height: 700 };
const el = (tag, display, left, top, width, height) => ({ tag, display, rect: { left, top, width, height } });
const plain = (box) => box && { ...box };

test('pointing at a word picks the paragraph around it, not the word', () => {
  const chain = [el('a', 'inline', 120, 100, 40, 16), el('p', 'block', 100, 90, 600, 80), el('article', 'block', 80, 40, 640, 900), el('body', 'block', 0, 0, 1000, 2000), el('html', 'block', 0, 0, 1000, 2000)];
  assert.deepEqual(plain(ocrArea.pick(chain, VIEWPORT)), { x: 100, y: 90, width: 600, height: 80 });
});

test('a box too small to be worth scanning gives way to the one around it', () => {
  const chain = [el('span', 'inline-block', 10, 10, 20, 12), el('button', 'inline-block', 5, 5, 90, 30), el('body', 'block', 0, 0, 1000, 700)];
  assert.deepEqual(plain(ocrArea.pick(chain, VIEWPORT)), { x: 5, y: 5, width: 90, height: 30 });
});

test('a picture or a video is picked as it is, even when it fills the screen', () => {
  assert.deepEqual(plain(ocrArea.pick([el('img', 'inline', 50, 60, 300, 200), el('p', 'block', 0, 0, 900, 400)], VIEWPORT)), { x: 50, y: 60, width: 300, height: 200 });
  assert.deepEqual(plain(ocrArea.pick([el('video', 'inline', 0, 0, 1000, 700)], VIEWPORT)), { x: 0, y: 0, width: 1000, height: 700 });
});

test('the page frame is never picked: that is what dragging and Enter are for', () => {
  assert.equal(ocrArea.pick([el('div', 'block', 0, 0, 1000, 3000), el('body', 'block', 0, 0, 1000, 3000)], VIEWPORT), null);
  assert.equal(ocrArea.pick([el('body', 'block', 0, 0, 1000, 700)], VIEWPORT), null);
  assert.equal(ocrArea.pick([], VIEWPORT), null);
});

test('a picked box is clipped to the viewport', () => {
  assert.deepEqual(plain(ocrArea.pick([el('section', 'block', -50, 600, 400, 300)], VIEWPORT)), { x: 0, y: 600, width: 350, height: 100 });
  assert.equal(ocrArea.pick([el('section', 'block', 100, 800, 400, 300)], VIEWPORT), null, 'below the screen');
});

/** An image filled with one colour, with "letters" of another in a few columns. */
function picture(width, height, background, letters, every = 6) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const colour = x % every === 0 && y > 2 && y < height - 3 ? letters : background;
      data.set([...colour, 255], (y * width + x) * 4);
    }
  }
  return { data, width, height };
}

test('a block: the colour there is more of is the background, the other the letters', () => {
  assert.deepEqual(blockColours(picture(120, 30, [255, 255, 255], [20, 20, 20]), { x: 0, y: 0, width: 120, height: 30 }), { background: '#ffffff', text: '#141414' });
  assert.deepEqual(blockColours(picture(120, 30, [10, 40, 120], [250, 250, 250]), { x: 0, y: 0, width: 120, height: 30 }), { background: '#0a2878', text: '#fafafa' });
});

test('a block with nothing to tell apart gets letters that can be read on it', () => {
  assert.equal(blockColours(picture(50, 20, [240, 240, 240], [240, 240, 240]), { x: 0, y: 0, width: 50, height: 20 }).text, '#111111');
  assert.equal(blockColours(picture(50, 20, [15, 15, 15], [30, 30, 30]), { x: 0, y: 0, width: 50, height: 20 }).text, '#fafafa');
  assert.equal(blockColours(picture(10, 10, [0, 0, 0], [0, 0, 0]), { x: 20, y: 20, width: 5, height: 5 }), null, 'outside the picture');
});
