'use strict';

// Captions the browser draws itself, as a word source: a <video> with a <track> (Coursera and
// many course sites, MediaElement.js, Video.js in Safari). The browser paints those captions
// outside the page's DOM, so there is no text to point at. When such a track is showing, it is
// switched to "hidden" (the browser stops painting it but keeps its cues current) and the same
// captions are drawn in a layer of our own, where the words are text.
//
// Only tracks the browser was painting are taken over ("showing"): a player that draws captions
// itself keeps its track "hidden" or "disabled", and adapters/dom.js reads its text instead.
// Turning captions off in the player (the track becomes "disabled") takes the layer away; when
// the feature stops, the track is given back to the browser.

(function (WV) {
  if (!WV.supported || !WV.captionSelectors) return;
  WV.captionAdapters = WV.captionAdapters || {};
  if (WV.captionAdapters.tracks) return;
  const { h } = WV;

  const KINDS = new Set(['subtitles', 'captions']);
  const SLACK = 1;
  /** How many times a player may switch a taken-over track back on before it is left alone. */
  const MAX_RECLAIMS = 3;

  // ASSUMPTION: captions sit centred near the bottom of the picture, in white on a dark box,
  // about as large as browsers draw them by default. Cue positions (line, position, region)
  // and VTT styling other than <b>, <i>, <u>, <ruby> are not reproduced.
  const CSS = `
    .wv-cc-video { position: fixed; pointer-events: none; overflow: hidden; }
    .wv-cc-lines {
      position: absolute; left: 4%; right: 4%; bottom: 7%;
      display: flex; flex-direction: column; align-items: center; gap: 0.15em;
      text-align: center; line-height: 1.25; white-space: pre-line;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
    }
    .wv-cc-cue { color: #fff; background: rgba(0, 0, 0, 0.8); padding: 0.05em 0.3em; border-radius: 2px; }
    ::highlight(wordvault-hover) { background-color: rgba(255, 204, 0, 0.5); }
  `;

  /** The track the browser is painting for a video, if any. */
  function showingTrack(video) {
    return [...video.textTracks].find((track) => KINDS.has(track.kind) && track.mode === 'showing') || null;
  }

  /** A cue's text as nodes; the browser parses its VTT markup into a safe fragment. */
  function cueContent(cue) {
    try {
      if (typeof cue.getCueAsHTML === 'function') return cue.getCueAsHTML();
    } catch {
      // Not a VTT cue; its plain text below.
    }
    return document.createTextNode(cue.text || '');
  }

  function create() {
    let surface = null;
    const states = new Map(); // video → { track, box, lines, cues: [{ element, cue }] }
    const watched = new WeakSet();
    const givenUp = new WeakSet(); // videos whose player keeps turning the track back on
    const resizes = new ResizeObserver(() => placeAll());

    function ensureSurface() {
      if (surface) return surface;
      surface = WV.createSurface(CSS);
      surface.mount();
      return surface;
    }

    function place(video, state) {
      const rect = video.getBoundingClientRect();
      Object.assign(state.box.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
      state.lines.style.fontSize = `${Math.max(14, Math.round(rect.height * 0.05))}px`;
      // Above the browser's own control bar, as the browser keeps its captions.
      state.lines.style.bottom = video.controls ? '16%' : '7%';
    }

    function placeAll() {
      for (const [video, state] of states) {
        if (!video.isConnected) release(video);
        else place(video, state);
      }
    }

    function render(video) {
      const state = states.get(video);
      if (!state) return;
      if (!chrome.runtime?.id) {
        stopAll(); // the extension was reloaded; give the captions back to the browser
        return;
      }
      const active = [...(state.track.activeCues || [])];
      state.cues = active.map((cue) => ({ cue, element: h('div', { class: 'wv-cc-cue' }, cueContent(cue)) }));
      state.lines.replaceChildren(...state.cues.map((item) => item.element));
      state.box.hidden = state.cues.length === 0;
      place(video, state);
      source.emit({ type: 'gone' });
    }

    function takeOver(video, track) {
      if (givenUp.has(video)) return;
      const current = states.get(video);
      if (current?.track === track) {
        // The player switched it back on itself. Some do that every time the track changes;
        // after a few rounds the browser is left to paint it rather than fight over it.
        if (++current.reclaimed > MAX_RECLAIMS) {
          givenUp.add(video);
          release(video, { keepTrack: true });
          return;
        }
        track.mode = 'hidden';
        return;
      }
      if (current) release(video, { keepTrack: true });
      const lines = h('div', { class: 'wv-cc-lines', lang: track.language || '' });
      const box = h('div', { class: 'wv-cc-video' }, lines);
      ensureSurface().root.append(box);
      const state = { track, box, lines, cues: [], reclaimed: 0, onCue: () => render(video) };
      states.set(video, state);
      track.mode = 'hidden';
      track.addEventListener('cuechange', state.onCue);
      resizes.observe(video);
      render(video);
    }

    function release(video, { keepTrack = false } = {}) {
      const state = states.get(video);
      if (!state) return;
      states.delete(video);
      state.track.removeEventListener('cuechange', state.onCue);
      state.box.remove();
      resizes.unobserve(video);
      // Given back to the browser unless the user turned it off (or chose another one).
      if (!keepTrack && state.track.mode === 'hidden') state.track.mode = 'showing';
      source.emit({ type: 'gone' });
    }

    /** A video's tracks changed: someone turned captions on, off, or to another language. */
    function update(video) {
      const showing = showingTrack(video);
      if (showing) {
        takeOver(video, showing);
        return;
      }
      const state = states.get(video);
      if (state && state.track.mode === 'disabled') release(video, { keepTrack: true });
    }

    function watch(video) {
      if (!(video instanceof HTMLVideoElement) || watched.has(video)) return;
      watched.add(video);
      const onChange = () => update(video);
      video.textTracks.addEventListener('change', onChange);
      video.textTracks.addEventListener('addtrack', onChange);
      update(video);
    }

    function onMedia(event) {
      watch(event.target);
    }

    function onScroll() {
      if (states.size > 0) placeAll();
    }

    // The top layer shows what entered it last on top, and a video going full screen enters
    // it after the layer: put the layer back on top of it.
    function onFullscreen() {
      if (surface && states.size > 0) surface.mount();
      placeAll();
    }

    function stopAll() {
      for (const video of [...states.keys()]) release(video);
      for (const type of ['loadstart', 'play', 'loadedmetadata']) document.removeEventListener(type, onMedia, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      document.removeEventListener('fullscreenchange', onFullscreen);
    }

    const inside = (rect, x, y) =>
      rect.width > 0 && x >= rect.left - SLACK && x <= rect.right + SLACK && y >= rect.top - SLACK && y <= rect.bottom + SLACK;

    const source = WV.wordSource.define({
      id: 'tracks',
      wordAt({ x, y }) {
        for (const state of states.values()) {
          if (state.box.hidden) continue;
          for (let index = 0; index < state.cues.length; index++) {
            const { element } = state.cues[index];
            if (!inside(element.getBoundingClientRect(), x, y)) continue;
            const lang = state.track.language || '';
            const word = WV.textPoint.wordAt({ x, y, nodes: WV.textPoint.textNodes(element), locale: lang });
            if (!word) continue;
            const line = WV.words.tidy(element.textContent);
            return {
              text: word.text,
              line,
              rect: word.rect,
              area: state.lines.getBoundingClientRect(),
              range: word.range,
              lang,
              key: `${line}\n${index}:${word.start}`,
            };
          }
        }
        return null;
      },
      stop: stopAll,
    });

    // Only now: taking a track over reports to the source's listeners.
    for (const type of ['loadstart', 'play', 'loadedmetadata']) document.addEventListener(type, onMedia, true);
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    document.addEventListener('fullscreenchange', onFullscreen);
    for (const video of document.querySelectorAll('video')) watch(video);
    return source;
  }

  WV.captionAdapters.tracks = {
    id: 'tracks',
    matches: () => true,
    needs: () => 'video',
    create,
  };
})(globalThis.WV);
