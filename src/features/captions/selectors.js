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

    // Players and sites that draw captions as text in the page (adapters/dom.js). For each:
    //   cue    One caption on screen: the element whose text is the caption (all its rows).
    //          Found by its position, so a caption layer the pointer passes through works too.
    //   hosts  (sites) Where the entry applies.
    //   needs  (players) An element of the player: the pointer is only followed on a page
    //          that has one, since a player can be on any site.
    // "Checked" means seen in the real player; "from" names where an unchecked entry comes from
    // (Firefox's picture-in-picture captions read the same elements: browser/extensions/
    // pictureinpicture/video-wrappers/ in mozilla-firefox/firefox).
    dom: {
      players: [
        // Video.js, and Brightcove's player (Cisco's training videos), Moodle, LinkedIn Learning
        // and other course sites built on it. Checked 2026-10-23 (Video.js 8.23.4, Brightcove):
        //   .video-js > .vjs-text-track-display (pointer-events: none) > div
        //     > .vjs-text-track-cue[lang] > div > text, rows separated by "\n"
        // In Safari Video.js leaves captions to the browser (adapters/tracks.js).
        { id: 'videojs', needs: '.video-js', cue: '.vjs-text-track-display .vjs-text-track-cue' },
        // Shaka Player. Checked 2026-10-23 (4.11.7):
        //   .shaka-video-container > .shaka-text-container > div > span > text
        { id: 'shaka', needs: '.shaka-video-container', cue: '.shaka-text-container > div' },
        // Plyr. Checked 2026-10-23 (3.7.8): .plyr > .plyr__captions > span.plyr__caption > text
        { id: 'plyr', needs: '.plyr', cue: '.plyr__captions .plyr__caption' },
        // Kaltura (playkit), common on university sites. From its source (playkit-js
        // src/track/text-track-display.ts): .playkit-subtitles > div > div (one per cue).
        { id: 'kaltura', needs: '.playkit-subtitles', cue: '.playkit-subtitles > div > div' },
        // JW Player. From Firefox (jwplayerWrapper.js: .jw-captions) and JW's own stylesheet
        // (.jw-text-track-cue).
        { id: 'jwplayer', needs: '.jwplayer', cue: '.jw-captions .jw-text-track-cue' },
      ],
      sites: [
        // From Netflix's player (TimedTextRenderer: .player-timedtext >
        // .player-timedtext-text-container > spans, rows split by <br>) and Firefox (netflix.js).
        // Some languages are drawn as pictures there (no text to find).
        { id: 'netflix', hosts: /(^|\.)netflix\.com$/, cue: '.player-timedtext-text-container' },
        // From Firefox (primeVideo.js); one element per row.
        { id: 'primevideo', hosts: /(^|\.)(primevideo\.com|amazon\.(com|ca|com\.mx|com\.br|co\.uk|de|fr|it|es|nl|se|pl|com\.tr|ae|sa|in|co\.jp|com\.au|sg))$/, cue: '.atvwebplayersdk-captions-text' },
        // From Firefox (disneyplus.js); one element per row, a Shaka layer in some countries.
        { id: 'disneyplus', hosts: /(^|\.)disneyplus\.com$/, cue: '.hive-subtitle-renderer-line, .shaka-text-container > div' },
        // From Firefox (hbomax.js) and a subtitle extension for play.hbomax.com.
        { id: 'max', hosts: /(^|\.)(hbo)?max\.com$/, cue: '[data-testid="CueBoxContainer"]' },
        // From Firefox (hulu.js): regular and live captions.
        { id: 'hulu', hosts: /(^|\.)hulu\.com$/, cue: '.ClosedCaption .CaptionBox, #inband-closed-caption > div > div > div' },
        // From Firefox (peacocktv.js).
        { id: 'peacock', hosts: /(^|\.)peacocktv\.com$/, cue: '[data-t-subtitles="true"], [data-t="subtitles"]' },
        // From Firefox (udemy.js) and two Udemy subtitle extensions.
        { id: 'udemy', hosts: /(^|\.)udemy\.com$/, cue: '[data-purpose="captions-cue-text"]' },
        // From Firefox (edx.js): the line under the video while captions are on.
        { id: 'edx', hosts: /(^|\.)edx\.org$/, cue: '.closed-captions.is-visible' },
        // Vimeo. From its player (4.46.132, player.module.js): div.vp-captions[lang] >
        // span (window) > span (one per row). The video does not play in a test browser.
        { id: 'vimeo', hosts: /(^|\.)vimeo\.com$/, cue: '.vp-captions' },
        // From Firefox (dailymotion.js, tubi.js).
        { id: 'dailymotion', hosts: /(^|\.)dailymotion\.com$/, cue: '.subtitles_placeholder' },
        { id: 'tubi', hosts: /(^|\.)tubitv\.com$/, cue: '[data-id="captionsComponent"]' },
      ],
    },
  };
})(globalThis.WV);
