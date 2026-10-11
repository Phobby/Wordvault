// The answer stopwatch: only time with the page in front of the user is counted.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

// shared/stopwatch.js is a classic script (it is also loaded into web pages), so it is run the
// way a browser runs it: with a global to hang its namespace on.
const sandbox = { WV: {} };
vm.runInNewContext(readFileSync(new URL('../src/shared/stopwatch.js', import.meta.url), 'utf8'), sandbox);
const { createStopwatch } = sandbox.WV;

/** A page whose time and attention the test controls. */
function fakePage({ visible = true } = {}) {
  const page = {
    time: 1000,
    visible,
    listeners: new Set(),
    now: () => page.time,
    watching: () => page.visible,
    subscribe(listener) {
      page.listeners.add(listener);
      return () => page.listeners.delete(listener);
    },
    pass(ms) {
      page.time += ms;
    },
    /** The tab is hidden or shown, the window loses or gains the focus. */
    set(isVisible) {
      page.visible = isVisible;
      for (const listener of page.listeners) listener();
    },
  };
  return page;
}

test('counts from start() to the moment it is read', () => {
  const page = fakePage();
  const watch = createStopwatch(page);
  page.pass(700);
  assert.equal(watch.elapsed(), 0, 'nothing before start()');
  watch.start();
  page.pass(1234.4);
  assert.equal(watch.elapsed(), 1234);
  page.pass(100);
  assert.equal(watch.elapsed(), 1334, 'reading it does not stop it');
});

test('time in a hidden tab or an unfocused window is not counted', () => {
  const page = fakePage();
  const watch = createStopwatch(page);
  watch.start();
  page.pass(800);
  page.set(false);
  page.pass(60_000); // off to another tab
  assert.equal(watch.elapsed(), 800);
  page.set(true);
  page.pass(500);
  assert.equal(watch.elapsed(), 1300);
  // several short absences
  for (let round = 0; round < 3; round++) {
    page.set(false);
    page.pass(5000);
    page.set(true);
    page.pass(100);
  }
  assert.equal(watch.elapsed(), 1600);
});

test('started while the page is not in front, it waits until it is', () => {
  const page = fakePage({ visible: false });
  const watch = createStopwatch(page);
  watch.start();
  page.pass(9000);
  assert.equal(watch.elapsed(), 0);
  page.set(true);
  page.pass(250);
  assert.equal(watch.elapsed(), 250);
});

test('repeated or contradictory signals change nothing', () => {
  const page = fakePage();
  const watch = createStopwatch(page);
  watch.start();
  watch.start();
  page.pass(300);
  // "blur" although the page still has the focus (the focus moved into one of its frames)
  page.set(true);
  page.set(true);
  page.pass(300);
  assert.equal(watch.elapsed(), 600);
  page.set(false);
  page.set(false);
  page.pass(300);
  assert.equal(watch.elapsed(), 600);
});

test('a state change nobody announced is noticed when the time is read', () => {
  const page = fakePage();
  const watch = createStopwatch(page);
  watch.start();
  page.pass(400);
  page.visible = false; // no event
  assert.equal(watch.elapsed(), 400);
  page.pass(5000);
  page.visible = true; // again without an event
  assert.equal(watch.elapsed(), 400, 'the unannounced absence is not counted');
  page.pass(100);
  assert.equal(watch.elapsed(), 500);
});

test('a clock that jumps backwards never produces negative time', () => {
  const page = fakePage();
  const watch = createStopwatch(page);
  watch.start();
  page.pass(-5000);
  assert.equal(watch.elapsed(), 0);
  page.set(false);
  page.set(true);
  page.pass(200);
  assert.equal(watch.elapsed(), 200);
});

test('stop() freezes the count and lets go of the page', () => {
  const page = fakePage();
  const watch = createStopwatch(page);
  watch.start();
  assert.equal(page.listeners.size, 1);
  page.pass(900);
  watch.stop();
  assert.equal(page.listeners.size, 0);
  page.pass(5000);
  page.set(false);
  page.set(true);
  page.pass(5000);
  assert.equal(watch.elapsed(), 900);
  watch.stop();
  assert.equal(watch.elapsed(), 900);
  // a stopwatch that was never started can be stopped and read
  const idle = createStopwatch(page);
  idle.stop();
  assert.equal(idle.elapsed(), 0);
  assert.equal(page.listeners.size, 0);
});
