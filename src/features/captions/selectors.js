'use strict';

// Every selector the captions feature uses to find things in a site's player, in one place:
// when a site changes its markup, this is the file to update.

(function (WV) {
  if (WV.captionSelectors) return;

  WV.captionSelectors = {
    // Checked against the embedded player on 2026-10-12:
    //   .ytp-caption-window-container > .caption-window > .captions-text
    //     > .caption-visual-line > .ytp-caption-segment > text
    youtube: {
      /** Where the adapter applies. */
      hosts: /(^|\.)youtube(-nocookie)?\.com$/,
      /** The layer captions are drawn in; there is one per player. */
      container: '.ytp-caption-window-container',
      /** One caption on screen (a player can show several, e.g. a speaker's and a sign's). */
      window: '.caption-window',
      /** One row of a caption as it is laid out. */
      line: '.caption-visual-line',
      /** A run of text within a row. Automatic captions draw a row in several of these. */
      segment: '.ytp-caption-segment',
    },
    // Video.js and the players built on it (Brightcove, which Cisco's training videos use).
    // Checked against Brightcove's player (Video.js 8.23.4) on 2026-10-23:
    //   .video-js > .vjs-text-track-display (pointer-events: none) > div
    //     > .vjs-text-track-cue[lang] > div > text, rows separated by "\n" (white-space: pre-line)
    // Video.js draws captions itself in Chrome and Firefox; only in Safari does it leave them to
    // the browser, where they are not in the DOM.
    videojs: {
      /** The player; also the element whose presence turns the feature on for a page. */
      player: '.video-js',
      /** The layer captions are drawn in. The pointer goes through it to the video. */
      display: '.vjs-text-track-display',
      /** One caption on screen, all its rows. */
      cue: '.vjs-text-track-cue',
    },
  };
})(globalThis.WV);
