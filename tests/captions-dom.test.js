// The adapter for captions drawn as text in the page (Netflix, Prime Video, Udemy, Video.js /
// Brightcove …): the caption under the pointer is found by its position, since many players
// draw captions in a layer the pointer passes through.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CHAR_WIDTH, LINE_HEIGHT, fakeDocument, layoutLine, loadScripts, pointOn } from './helpers/hover.js';

/** The page the adapter sees: whatever captions a test puts on it. */
const page = { cues: [], selectors: [] };
const timers = [];
const WV = loadScripts(
  ['core/hover/words.js', 'core/hover/word-source.js', 'core/hover/text-point.js', 'features/captions/selectors.js', 'features/captions/adapters/dom.js'],
  {
    document: {
      querySelectorAll(selector) {
        page.selectors.push(selector);
        return page.cues;
      },
    },
    setInterval: (fn) => timers.push(fn) - 1,
    clearInterval: (id) => (timers[id] = null),
    location: { hostname: 'www.example.com' },
  },
);
const adapter = WV.captionAdapters.dom;
const tick = () => timers.forEach((fn) => fn?.());

const boxOf = (nodes) => {
  const left = Math.min(...nodes.map((node) => node.box.left));
  const right = Math.max(...nodes.map((node) => node.box.right));
  const top = Math.min(...nodes.map((node) => node.box.top));
  const bottom = Math.max(...nodes.map((node) => node.box.bottom));
  return { left, right, top, bottom, width: right - left, height: bottom - top };
};

/**
 * Captions on screen. Each caption is a list of rows, each row a list of text pieces; the
 * browser's caret call answers with another element, as it does under pointer-events: none.
 */
function show(captions, { lang = '' } = {}) {
  let top = 400;
  const all = [];
  const cues = captions.map((rows) => {
    const nodes = rows.flatMap((pieces) => {
      const row = layoutLine(pieces, { top, left: 100 });
      top += LINE_HEIGHT;
      return row;
    });
    for (const node of nodes) node.isConnected = true;
    all.push(...nodes);
    return {
      nodes,
      innerText: rows.map((pieces) => pieces.join('')).join('\n'),
      textContent: nodes.map((node) => node.data).join(''),
      getBoundingClientRect: () => boxOf(nodes),
      getAttribute: (name) => (name === 'lang' ? lang || null : null),
    };
  });
  const doc = fakeDocument(all, { caret: 'elsewhere' });
  doc.createTreeWalker = (root) => {
    const queue = [...root.nodes];
    return { nextNode: () => queue.shift() || null };
  };
  for (const cue of cues) cue.ownerDocument = doc;
  page.cues = cues;
  return cues;
}

test('the word under the pointer, through a caption layer the pointer passes through', () => {
  const [cue] = show([[['Configure the router interface']]], { lang: 'en' });
  const source = adapter.create(adapter.entriesFor({ hostname: 'www.netacad.com' }));
  const hit = source.wordAt({ ...pointOn(cue.nodes[0], 15), target: { closest: () => null } });
  assert.equal(hit.text, 'router');
  assert.equal(hit.line, 'Configure the router interface');
  assert.equal(hit.lang, 'en');
  assert.equal(hit.range.toString(), 'router');
  assert.deepEqual([hit.rect.left, hit.rect.width], [100 + 14 * CHAR_WIDTH, 6 * CHAR_WIDTH]);
  assert.equal(hit.area.left, 100, 'the caption is the area the bubble keeps clear of');
});

test('rows of one caption stay apart: the end of one row and the start of the next are two words', () => {
  // Netflix: one caption element, rows split by <br>, no space between the rows' text
  const [cue] = show([[['with an IPv4'], ['address.']]]);
  const source = adapter.create(adapter.entriesFor({ hostname: 'www.netflix.com' }));
  assert.equal(source.wordAt(pointOn(cue.nodes[0], 9)).text, 'IPv4');
  const second = source.wordAt(pointOn(cue.nodes[1], 2));
  assert.equal(second.text, 'address');
  assert.equal(second.line, 'with an IPv4 address.', 'the context is the whole caption, rows joined');
});

test('with two captions on screen, the one under the pointer is used', () => {
  const [first, second] = show([[['first line here']], [['with an IPv4 address.']]]);
  const source = adapter.create();
  const hit = source.wordAt(pointOn(second.nodes[0], 9));
  assert.equal(hit.text, 'IPv4');
  assert.notEqual(source.wordAt(pointOn(first.nodes[0], 1)).key, hit.key);
});

test('no word: away from the captions, between words, no captions at all', () => {
  const [cue] = show([[['Configure the router']]]);
  const source = adapter.create();
  assert.equal(source.wordAt({ x: 50, y: 100 }), null, 'on the picture, away from the caption');
  assert.equal(source.wordAt(pointOn(cue.nodes[0], 9)), null, 'the space between two words');
  show([]);
  assert.equal(source.wordAt({ x: 150, y: 410 }), null);
});

test('the same caption drawn again keeps the word; a new caption lets go of it', () => {
  let [cue] = show([[['Configure the router']]]);
  const source = adapter.create();
  const events = [];
  source.subscribe((event) => events.push(event.type));
  const point = pointOn(cue.nodes[0], 15);
  source.wordAt(point);
  tick();
  assert.deepEqual(events, [], 'nothing changed');

  // the player draws the same text again with new elements (Video.js when its controls appear)
  cue.nodes[0].isConnected = false;
  [cue] = show([[['Configure the router']]]);
  tick();
  assert.deepEqual(events, [], 'same word at the same place');

  cue.nodes[0].isConnected = false;
  show([[['Save the configuration']]]);
  tick();
  assert.deepEqual(events, ['gone']);
});

test('which entries apply: a site\'s own, and every player\'s anywhere', () => {
  const ids = (hostname) => adapter.entriesFor({ hostname }).map((entry) => entry.id);
  assert.ok(ids('www.netflix.com').includes('netflix'));
  assert.ok(ids('www.netflix.com').includes('videojs'));
  assert.ok(ids('www.primevideo.com').includes('primevideo'));
  assert.ok(ids('www.amazon.com.tr').includes('primevideo'));
  assert.ok(ids('www.udemy.com').includes('udemy'));
  assert.ok(!ids('www.netacad.com').includes('netflix'));
  assert.ok(ids('www.netacad.com').includes('videojs'));
  assert.ok(!ids('notnetflix.com').includes('netflix'), 'a host that only ends the same way');

  assert.equal(adapter.needs({ hostname: 'www.netflix.com' }), null, 'a site of its own: from the start');
  const needs = adapter.needs({ hostname: 'www.netacad.com' });
  for (const player of ['.video-js', '.shaka-video-container', '.plyr', '.playkit-subtitles', '.jwplayer']) {
    assert.ok(needs.includes(player), player);
  }
});

test('the page is asked for every caption the entries describe, in one query', () => {
  show([]);
  page.selectors = [];
  adapter.create(adapter.entriesFor({ hostname: 'www.udemy.com' })).wordAt({ x: 1, y: 1 });
  assert.equal(page.selectors.length, 1);
  assert.ok(page.selectors[0].includes('[data-purpose="captions-cue-text"]'));
  assert.ok(page.selectors[0].includes('.vjs-text-track-cue'));
});
