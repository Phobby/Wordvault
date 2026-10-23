'use strict';

// Captions: hovering a word of a video's captions translates it. This file only picks the
// adapters for the page; finding the word, the highlight and the bubble are shared (core/hover,
// ui/popup) and do not know about captions.

(function (WV) {
  if (!WV.supported || !WV.hover || WV.captions) return;

  // A site's own adapter (YouTube) is asked first, then the ones for players that can be on
  // any site: captions drawn as text (dom), then captions the browser draws (tracks).
  const ORDER = ['youtube', 'dom', 'tracks'];
  const adapters = ORDER.map((id) => WV.captionAdapters?.[id]).filter((adapter) => adapter && adapter.matches(location));
  if (adapters.length === 0) return;

  // One pointer pipeline for the page, with the sources of the adapters that started so far.
  const members = [];
  let hover = null;
  const source = WV.wordSource.define({
    id: 'captions',
    wordAt(point) {
      for (const member of members) {
        let hit = null;
        try {
          hit = member.wordAt(point);
        } catch {
          // One source failing on some text does not keep the others from answering.
        }
        if (hit) return hit;
      }
      return null;
    },
  });

  WV.captions = { adapters: [], source };

  function start(adapter) {
    if (WV.captions.adapters.includes(adapter.id)) return;
    const member = adapter.create();
    member.subscribe((event) => source.emit(event));
    members.push(member);
    members.sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
    WV.captions.adapters.push(adapter.id);
    hover ||= WV.hover.start({ source });
    WV.captions.hover = hover;
  }

  // An adapter for a player that can be on any page waits for that player, so that pages
  // without one do not follow the pointer at all. Media events do not bubble but are seen on
  // their way down (capture); a player added later, or loaded into the page by a script, is
  // caught when its video starts loading or playing.
  const waiting = [];
  for (const adapter of adapters) {
    const needs = typeof adapter.needs === 'function' ? adapter.needs(location) : adapter.needs;
    if (!needs || document.querySelector(needs)) start(adapter);
    else waiting.push({ adapter, needs });
  }
  if (waiting.length === 0) return;

  const EVENTS = ['loadstart', 'play'];
  function onMedia(event) {
    if (!(event.target instanceof Element)) return;
    for (const item of [...waiting]) {
      if (!event.target.closest(item.needs) && !document.querySelector(item.needs)) continue;
      waiting.splice(waiting.indexOf(item), 1);
      start(item.adapter);
    }
    if (waiting.length === 0) for (const type of EVENTS) document.removeEventListener(type, onMedia, true);
  }
  for (const type of EVENTS) document.addEventListener(type, onMedia, true);
})(globalThis.WV);
