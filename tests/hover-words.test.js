// The hover pipeline that every word source shares: word boundaries, the word under a point,
// when a hover counts, and the contract a source has to keep.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CHAR_WIDTH, fakeDocument, layoutLine, loadScripts, pointOn } from './helpers/hover.js';

const WV = loadScripts(['core/hover/words.js', 'core/hover/word-source.js', 'core/hover/text-point.js', 'core/hover/tracker.js']);
const { words, textPoint, wordSource, createHoverTracker } = WV;
const texts = (list) => Array.from(list, (word) => word.text);
/** Results come out of another realm (the scripts run as in a browser); compare by content. */
const plain = (value) => JSON.parse(JSON.stringify(value));

// --- Word boundaries ----------------------------------------------------------------------------

test('a line is split into its words; punctuation and numbers on their own are not words', () => {
  assert.deepEqual(texts(words.split('All right, so here we are — in front of the elephants.')), [
    'All', 'right', 'so', 'here', 'we', 'are', 'in', 'front', 'of', 'the', 'elephants',
  ]);
  assert.deepEqual(texts(words.split("and that's cool, isn’t it? 42 times")), ['and', "that's", 'cool', 'isn’t', 'it', 'times']);
  assert.deepEqual(texts(words.split('Çağrı öğleden sonra İstanbul’a gidiyor')), ['Çağrı', 'öğleden', 'sonra', 'İstanbul’a', 'gidiyor']);
  assert.deepEqual(texts(words.split('')), []);
});

test('the word a character belongs to; nothing between words', () => {
  const line = 'really long trunks';
  assert.deepEqual(plain(words.at(line, 0)), { text: 'really', start: 0, end: 6 });
  assert.equal(words.at(line, 5).text, 'really');
  assert.equal(words.at(line, 6), null, 'the space after it');
  assert.equal(words.at(line, 7).text, 'long');
  assert.equal(words.at(line, 17).text, 'trunks');
  assert.equal(words.at(line, 18), null, 'past the end');
  assert.equal(words.at(line, -1), null);
  assert.equal(words.at('wait... what', 5), null, 'punctuation');
});

test('languages written without spaces are split by dictionary', () => {
  const japanese = words.split('私は学生です', 'ja');
  assert.ok(japanese.length >= 3, `several words, got ${texts(japanese).join('|')}`);
  assert.equal(texts(japanese).join(''), '私は学生です');
  assert.equal(words.at('私は学生です', 2, 'ja').text, '学生');
  const chinese = words.split('我喜欢学习语言', 'zh');
  assert.ok(chinese.length >= 3, texts(chinese).join('|'));
  assert.ok(words.split('ฉันชอบเรียนภาษา', 'th').length >= 3);
});

test('right-to-left text is split in reading order', () => {
  assert.deepEqual(texts(words.split('مرحبا بكم في القناة', 'ar')), ['مرحبا', 'بكم', 'في', 'القناة']);
  assert.deepEqual(texts(words.split('שלום לכולם', 'he')), ['שלום', 'לכולם']);
  assert.equal(words.at('שלום לכולם', 6, 'he').text, 'לכולם');
});

test('music notes and sound descriptions are not words', () => {
  assert.deepEqual(texts(words.split('♪ la la ♪')), ['la', 'la']);
  assert.deepEqual(texts(words.split('[Music] and then [Applause]')), ['and', 'then']);
  assert.equal(words.at('[Music] hello', 2), null);
  assert.equal(words.at('[Music] hello', 9).text, 'hello');
  assert.equal(words.at('♪', 0), null);
});

test('a language tag the browser does not know falls back to its default rules', () => {
  assert.deepEqual(texts(words.split('one two', 'not a tag')), ['one', 'two']);
});

test('pieces of text read as one line, each position traceable to its piece', () => {
  const line = words.join(['and that', "'s pretty", ' much']);
  assert.equal(line.text, "and that's pretty much");
  assert.equal(line.indexOf(1, 0), 8);
  assert.deepEqual(plain(line.locate(4)), { piece: 0, offset: 4 });
  assert.deepEqual(plain(line.locate(8)), { piece: 1, offset: 0 }, 'a start on a boundary is in the piece after');
  assert.deepEqual(plain(line.locate(8, true)), { piece: 0, offset: 8 }, 'an end on a boundary is in the piece before');
  assert.deepEqual(plain(line.locate(22, true)), { piece: 2, offset: 5 });
  assert.equal(line.locate(23), null);
  assert.equal(words.tidy('  two\n  rows '), 'two rows');
});

// --- The word under a point ----------------------------------------------------------------------

for (const caret of ['position', 'range', 'none', 'elsewhere']) {
  test(`the word under the pointer (text position from the browser: ${caret})`, () => {
    const nodes = layoutLine(['the cool thing about these guys']);
    const doc = fakeDocument(nodes, { caret });
    const find = (offset, dx = 0) => {
      const point = pointOn(nodes[0], offset);
      return textPoint.wordAt({ x: point.x + dx, y: point.y, nodes, doc });
    };
    assert.equal(find(4).text, 'cool');
    // either half of a letter: the reported position is the gap before or the gap after it
    assert.equal(find(4, -4).text, 'cool');
    assert.equal(find(7, 4).text, 'cool');
    assert.equal(find(8), null, 'the space after it');
    assert.equal(find(9).text, 'thing');
    const word = find(15);
    assert.equal(word.text, 'about');
    assert.equal(word.range.toString(), 'about');
    assert.deepEqual([word.rect.left, word.rect.width], [15 * CHAR_WIDTH, 5 * CHAR_WIDTH], 'where the word is on screen');
    assert.equal(textPoint.wordAt({ x: 5, y: 200, nodes, doc }), null, 'below the line');
    assert.equal(textPoint.wordAt({ x: 5000, y: 10, nodes, doc }), null, 'past its end');
  });
}

test('a word drawn in several pieces is found whole, from any of its pieces', () => {
  // automatic captions: one piece per word or so, cut wherever the recogniser stopped
  const nodes = layoutLine(['pretty', ' much all the', 're is to']);
  const doc = fakeDocument(nodes);
  const there = textPoint.wordAt({ ...pointOn(nodes[2], 0), nodes, doc });
  assert.equal(there.text, 'there');
  assert.equal(there.range.toString(), 'there');
  assert.equal(textPoint.wordAt({ ...pointOn(nodes[1], 11), nodes, doc }).text, 'there');
  assert.equal(textPoint.wordAt({ ...pointOn(nodes[0], 2), nodes, doc }).text, 'pretty');
  assert.equal(textPoint.wordAt({ ...pointOn(nodes[1], 0), nodes, doc }), null, 'the space a piece starts with');
});

test('a gap between two pieces of a line belongs to no word', () => {
  const nodes = layoutLine(['left ', { text: 'right', gap: 40 }]);
  const doc = fakeDocument(nodes, { caret: 'none' });
  assert.equal(textPoint.wordAt({ x: 70, y: 10, nodes, doc }), null);
  assert.equal(textPoint.wordAt({ x: 95, y: 10, nodes, doc }).text, 'right');
  assert.equal(textPoint.wordAt({ x: 35, y: 10, nodes, doc }).text, 'left');
});

test('text without spaces: the word is the dictionary word under the pointer', () => {
  const nodes = layoutLine(['私は学生です']);
  const doc = fakeDocument(nodes);
  const word = textPoint.wordAt({ ...pointOn(nodes[0], 3), nodes, doc, locale: 'ja' });
  assert.equal(word.text, '学生');
  assert.deepEqual([word.rect.left, word.rect.width], [2 * CHAR_WIDTH, 2 * CHAR_WIDTH]);
});

test('right-to-left text: the word under the pointer, laid out from the right', () => {
  const nodes = layoutLine(['مرحبا بكم في القناة'], { rtl: true });
  const doc = fakeDocument(nodes);
  const first = textPoint.wordAt({ ...pointOn(nodes[0], 1), nodes, doc, locale: 'ar' });
  assert.equal(first.text, 'مرحبا');
  assert.equal(first.rect.right, nodes[0].box.right, 'the first word is at the right edge');
  // the leftmost letters on screen are the end of the line
  assert.equal(textPoint.wordAt({ x: nodes[0].box.left + 5, y: 10, nodes, doc, locale: 'ar' }).text, 'القناة');
  assert.equal(textPoint.wordAt({ ...pointOn(nodes[0], 5), nodes, doc, locale: 'ar' }), null, 'the space between words');
});

test('no nodes, no word', () => {
  assert.equal(textPoint.wordAt({ x: 1, y: 1, nodes: [], doc: fakeDocument([]) }), null);
});

// --- When a hover counts --------------------------------------------------------------------------

function trackerWithClock(options = {}) {
  const timers = new Map();
  let nextId = 1;
  let now = 0;
  const shown = [];
  const targets = [];
  const tracker = createHoverTracker({
    onShow: (hit) => shown.push(hit.text),
    onTarget: (hit) => targets.push(hit ? hit.text : null),
    setTimer: (fn, ms) => {
      timers.set(nextId, { fn, at: now + ms });
      return nextId++;
    },
    clearTimer: (id) => timers.delete(id),
    ...options,
  });
  const advance = (ms) => {
    now += ms;
    for (const [id, timer] of [...timers]) {
      if (timer.at <= now) {
        timers.delete(id);
        timer.fn();
      }
    }
  };
  return { tracker, shown, targets, advance };
}
const hit = (text, line = 'a line') => ({ text, key: `${line}\n${text}` });

test('a word is looked up after the pointer rested on it for about 150 ms', () => {
  const { tracker, shown, targets, advance } = trackerWithClock();
  assert.equal(WV.HOVER_DELAY_MS, 150);
  tracker.move(hit('cool'));
  assert.deepEqual(targets, ['cool'], 'marked at once');
  advance(149);
  assert.deepEqual(shown, []);
  advance(1);
  assert.deepEqual(shown, ['cool']);
});

test('passing over words on the way somewhere looks none of them up', () => {
  const { tracker, shown, advance } = trackerWithClock();
  for (const word of ['the', 'cool', 'thing']) {
    tracker.move(hit(word));
    advance(100);
  }
  tracker.move(null);
  advance(500);
  assert.deepEqual(shown, []);
});

test('moving within a word neither restarts the wait nor opens the bubble twice', () => {
  const { tracker, shown, targets, advance } = trackerWithClock();
  tracker.move(hit('cool'));
  advance(100);
  tracker.move(hit('cool'));
  advance(50);
  assert.deepEqual(shown, ['cool'], 'the wait started with the first move');
  for (let n = 0; n < 5; n++) {
    tracker.move(hit('cool'));
    advance(200);
  }
  assert.deepEqual(shown, ['cool']);
  assert.deepEqual(targets, ['cool']);
});

test('leaving the word and coming back is a new hover; the same word in another line too', () => {
  const { tracker, shown, targets, advance } = trackerWithClock();
  tracker.move(hit('cool'));
  advance(150);
  tracker.move(null);
  tracker.move(hit('cool'));
  advance(150);
  tracker.move(hit('cool', 'another line'));
  advance(150);
  assert.deepEqual(shown, ['cool', 'cool', 'cool']);
  assert.deepEqual(targets, ['cool', null, 'cool', 'cool']);
});

test('when the text goes away the mark goes too and nothing is looked up', () => {
  const { tracker, shown, targets, advance } = trackerWithClock();
  tracker.move(hit('cool'));
  advance(100);
  tracker.reset();
  advance(500);
  assert.deepEqual(shown, []);
  assert.deepEqual(targets, ['cool', null]);
  assert.equal(tracker.target, null);
});

// --- The contract ---------------------------------------------------------------------------------

test('a word source needs an id and wordAt; it gets its listeners from the contract', () => {
  assert.throws(() => wordSource.define({ id: 'x' }), /word source/);
  assert.throws(() => wordSource.define({ wordAt() {} }), /word source/);
  const source = wordSource.define({ id: 'picture', wordAt: () => null });
  const events = [];
  const unsubscribe = source.subscribe((event) => events.push(event.type));
  source.emit({ type: 'gone' });
  unsubscribe();
  source.emit({ type: 'gone' });
  assert.deepEqual(events, ['gone']);
});

test('a hit is what the bubble may rely on, wherever it came from', () => {
  // a source without a DOM (recognised text of a picture): a word, its line and a box are enough
  const box = { left: 10, top: 20, width: 30, height: 12 };
  assert.deepEqual(plain(wordSource.normalise({ text: 'cool', line: 'the cool thing', rect: box }, 'picture')), {
    text: 'cool',
    line: 'the cool thing',
    rect: box,
    area: null,
    range: null,
    lang: '',
    key: 'the cool thing\ncool',
    source: 'picture',
  });
  assert.equal(wordSource.normalise({ text: 'cool', rect: box }, 'picture').line, 'cool', 'no line: the word is its own context');
  assert.equal(wordSource.normalise(null, 'picture'), null);
  assert.equal(wordSource.normalise({ text: '', rect: box }, 'picture'), null);
  assert.equal(wordSource.normalise({ text: 'cool' }, 'picture'), null, 'a word without a place cannot be pointed at');
});
