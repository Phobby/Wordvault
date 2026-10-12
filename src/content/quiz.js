'use strict';

// Shows a quiz in this page when the background script says one is due, unless this is a bad
// moment for it. The page knows things the background script cannot see: whether a video is
// playing, whether the user is typing.
//
// Runs in web pages as a content script and in the extension's own options page, so that a quiz
// can appear there like anywhere else.

(function (WV) {
  // Quizzes belong to the page the user is looking at, not to frames inside it.
  if (!WV.supported || WV.quiz || window !== window.top) return;
  WV.quiz = true;

  /** Someone who pressed a key in a text field this recently is still writing. */
  const TYPING_WINDOW_MS = 30_000;
  let lastTypedAt = 0;

  function focusedEditable() {
    let element = document.activeElement;
    while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
    if (!element || element === document.body) return false;
    const name = element.localName;
    return name === 'input' || name === 'textarea' || name === 'select' || element.isContentEditable || element.getAttribute('role') === 'textbox';
  }

  window.addEventListener(
    'keydown',
    (event) => {
      if (event.isTrusted && focusedEditable()) lastTypedAt = Date.now();
    },
    { capture: true, passive: true },
  );

  /** A video the user is watching: playing with sound. Muted decoration does not count. */
  function videoPlaying() {
    return [...document.querySelectorAll('video')].some((video) => !video.paused && !video.ended && video.readyState > 2 && !video.muted && video.volume > 0);
  }

  /** Why a quiz should not appear right now ('' if it may). The codes are explained to the
   *  user on the options page (see the quizWhy* messages). */
  function blockedReason() {
    if (document.visibilityState !== 'visible') return 'tab_hidden';
    if (!document.hasFocus()) return 'window_not_focused';
    if (WV.quizCard.isOpen()) return 'already_showing';
    if (WV.popup?.isOpen()) return 'popup_open';
    if (document.fullscreenElement) return 'fullscreen';
    if (videoPlaying()) return 'video_playing';
    if (focusedEditable() && Date.now() - lastTypedAt < TYPING_WINDOW_MS) return 'typing';
    return '';
  }

  /** Shows the quiz as a card. What the card reports goes to the background script; its
   *  reply says what comes next. */
  function showCard(quiz) {
    // If this page goes away with the card on it, the background script notices the
    // connection breaking and counts the open question as closed.
    const link = WV.stayConnected(`wv:quiz:${quiz.sessionId}`);
    WV.quizCard.show(quiz, {
      report: (result) => WV.send('wv:quiz:answer', result),
      mute: () => WV.send('wv:quiz:mute'),
      onClose: () => link.end(),
    });
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Asked before a quiz is shown in any way: a popup over a film is as unwelcome as a card.
    if (message?.type === 'wv:quiz:probe') {
      sendResponse({ blocked: blockedReason() });
      return false;
    }
    if (message?.type !== 'wv:quiz:show') return false;
    // "Test now" shows the quiz whatever the moment is like; the timer does not.
    const reason = message.force ? '' : blockedReason();
    if (reason) {
      sendResponse({ shown: false, reason });
    } else {
      showCard(message.quiz);
      sendResponse({ shown: true });
    }
    return false;
  });
})(globalThis.WV);
