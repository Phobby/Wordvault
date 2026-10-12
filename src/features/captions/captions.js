'use strict';

// Captions: hovering a word of a video's captions translates it. This file only picks the
// adapter for the site; finding the word, the highlight and the bubble are shared (core/hover,
// ui/popup) and do not know about captions.

(function (WV) {
  if (!WV.supported || !WV.hover || WV.captions) return;

  const adapter = Object.values(WV.captionAdapters || {}).find((candidate) => candidate.matches(location));
  if (!adapter) return;

  WV.captions = { adapter: adapter.id, hover: WV.hover.start({ source: adapter.create() }) };
})(globalThis.WV);
