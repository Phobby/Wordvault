'use strict';

// Captions: hovering a word of a video's captions translates it. This file only picks the
// adapter for the site; finding the word, the highlight and the bubble are shared (core/hover,
// ui/popup) and do not know about captions.

(function (WV) {
  if (!WV.supported || !WV.hover || WV.captions) return;

  // The first adapter that matches wins: site adapters (YouTube) are loaded before the ones for
  // players that can be on any site (Video.js).
  const adapter = Object.values(WV.captionAdapters || {}).find((candidate) => candidate.matches(location));
  if (!adapter) return;

  function start() {
    if (WV.captions) return;
    WV.captions = { adapter: adapter.id, hover: WV.hover.start({ source: adapter.create() }) };
  }

  if (!adapter.needs || document.querySelector(adapter.needs)) {
    start();
    return;
  }

  // An adapter for a player that can be on any page waits for that player, so that pages
  // without one do not follow the pointer at all. Media events do not bubble but are seen on
  // their way down (capture); a player added later, or loaded into the page by a script, is
  // caught when its video starts loading or playing.
  const EVENTS = ['loadstart', 'play'];
  function onMedia(event) {
    if (!(event.target instanceof Element) || !event.target.closest(adapter.needs)) return;
    for (const type of EVENTS) document.removeEventListener(type, onMedia, true);
    start();
  }
  for (const type of EVENTS) document.addEventListener(type, onMedia, true);
})(globalThis.WV);
