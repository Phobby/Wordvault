// The Video.js captions adapter (Brightcove's player, used for Cisco's training videos): the
// caption layer lets the pointer through, so the caption under the pointer is found by its box.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CHAR_WIDTH, LINE_HEIGHT, fakeDocument, layoutLine, loadScripts, pointOn } from './helpers/hover.js';

const observers = [];
class FakeMutationObserver {
  constructor(callback) {
    this.callback = callback;
    observers.push(this);
  }
  observe(target) {
    this.target = target;
  }
  disconnect() {
    this.target = null;
  }
}

const WV = loadScripts(
  [
    'core/hover/words.js',
    'core/hover/word-source.js',
    'core/hover/text-point.js',
    'features/captions/selectors.js',
    'features/captions/adapters/videojs.js',
  ],
  { MutationObserver: FakeMutationObserver },
);

const box = (nodes) => {
  const left = Math.min(...nodes.map((node) => node.box.left));
  const right = Math.max(...nodes.map((node) => node.box.right));
  const top = Math.min(...nodes.map((node) => node.box.top));
  const bottom = Math.max(...nodes.map((node) => node.box.bottom));
  return { left, right, top, bottom, width: right - left, height: bottom - top };
};

/**
 * A Video.js player showing captions, each a list of text pieces on one row. The browser's
 * caret call answers with another element, as it does for text under pointer-events: none.
 */
function player(captions, { lang = 'en' } = {}) {
  const rows = captions.map((pieces, index) => layoutLine(pieces, { top: 400 + index * LINE_HEIGHT, left: 100 }));
  const doc = fakeDocument(rows.flat(), { caret: 'elsewhere' });
  doc.createTreeWalker = (root) => {
    const queue = [...root.nodes];
    return { nextNode: () => queue.shift() || null };
  };
  const cues = rows.map((nodes) => ({
    nodes,
    ownerDocument: doc,
    textContent: nodes.map((node) => node.data).join(''),
    firstElementChild: { getBoundingClientRect: () => box(nodes) },
    getAttribute: (name) => (name === 'lang' ? lang : null),
  }));
  const display = { querySelectorAll: (selector) => (selector === '.vjs-text-track-cue' ? cues : []) };
  const element = { querySelector: (selector) => (selector === '.vjs-text-track-display' ? display : null) };
  // The element under the pointer: the video inside the player, whatever the caption above it.
  const video = { closest: (selector) => (selector === '.video-js' ? element : null) };
  return { rows, cues, display, video };
}

test('the word under the pointer in a caption the pointer passes through', () => {
  const { rows, video } = player([['Configure the router interface']]);
  const source = WV.captionAdapters.videojs.create();
  const hit = source.wordAt({ ...pointOn(rows[0][0], 15), target: video });
  assert.equal(hit.text, 'router');
  assert.equal(hit.line, 'Configure the router interface');
  assert.equal(hit.lang, 'en');
  assert.equal(hit.range.toString(), 'router');
  assert.deepEqual([hit.rect.left, hit.rect.width], [100 + 14 * CHAR_WIDTH, 6 * CHAR_WIDTH]);
  assert.equal(hit.area.left, 100, 'the caption is the area the bubble keeps clear of');
});

test('with two captions on screen, the one under the pointer is used', () => {
  const { rows, video } = player([['first line here'], ['with an IPv4 address.']]);
  const source = WV.captionAdapters.videojs.create();
  const hit = source.wordAt({ ...pointOn(rows[1][0], 9), target: video });
  assert.equal(hit.text, 'IPv4');
  assert.equal(hit.line, 'with an IPv4 address.');
  const other = source.wordAt({ ...pointOn(rows[0][0], 1), target: video });
  assert.notEqual(other.key, hit.key);
});

test('no word: outside the captions, between words, outside a player', () => {
  const { rows, video } = player([['Configure the router']]);
  const source = WV.captionAdapters.videojs.create();
  assert.equal(source.wordAt({ x: 50, y: 100, target: video }), null, 'on the picture, away from the caption');
  assert.equal(source.wordAt({ ...pointOn(rows[0][0], 9), target: video }), null, 'the space between two words');
  const page = { closest: () => null };
  assert.equal(source.wordAt({ ...pointOn(rows[0][0], 2), target: page }), null, 'not in a player');
  assert.equal(source.wordAt({ ...pointOn(rows[0][0], 2), target: null }), null);
});

test('a redrawn caption layer lets go of the word', () => {
  const { rows, display, video } = player([['Configure the router']]);
  const source = WV.captionAdapters.videojs.create();
  const events = [];
  source.subscribe((event) => events.push(event.type));
  source.wordAt({ ...pointOn(rows[0][0], 2), target: video });
  const observer = observers.find((candidate) => candidate.target === display);
  assert.ok(observer, 'the caption layer is watched');
  observer.callback([]);
  assert.deepEqual(events, ['gone']);
});

test('the adapter applies on any site but only once a player is there', () => {
  const adapter = WV.captionAdapters.videojs;
  assert.equal(adapter.matches({ hostname: 'www.netacad.com' }), true);
  assert.equal(adapter.needs, '.video-js');
});
