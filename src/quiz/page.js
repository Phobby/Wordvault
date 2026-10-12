'use strict';

// The quiz in a place of its own: the toolbar popup (?surface=popup) or the quiz window
// (?surface=window). The page asks the background script for the quiz that is waiting for it,
// shows it with the same component the card on a page uses, and goes away when it is over.

(async function (WV) {
  const surface = new URLSearchParams(location.search).get('surface') === 'window' ? 'window' : 'popup';
  document.documentElement.dataset.surface = surface;
  document.documentElement.lang = WV.languages.uiLanguage();
  document.title = `${WV.t('quizTitle')} · Wordvault`;
  WV.adoptStyles(WV.styles.tokens + WV.styles.controls + WV.styles.quiz);

  function leave() {
    if (surface === 'window') {
      chrome.windows
        .getCurrent()
        .then((current) => chrome.windows.remove(current.id))
        .catch(() => window.close());
    } else {
      window.close();
    }
  }

  let quiz = null;
  try {
    quiz = await WV.send('wv:quiz:claim', { surface });
  } catch {
    // The background script cannot be reached; there is nothing to show.
  }
  if (!quiz) {
    // No quiz is waiting for this page: it was shown some other way, or the page was opened by
    // hand. The toolbar button belongs to the vault.
    if (surface === 'popup') {
      const usual = chrome.runtime.getManifest().action?.default_popup;
      if (usual) {
        await chrome.action.setPopup({ popup: usual }).catch(() => {});
        location.replace(chrome.runtime.getURL(usual));
        return;
      }
    }
    leave();
    return;
  }

  // The toolbar popup goes away when the user clicks elsewhere, and the window has a close
  // button of its own. The background script learns of that from this connection breaking,
  // and counts a question that was still open as closed.
  const link = WV.stayConnected(`wv:quiz:${quiz.sessionId}`);
  WV.quizCard.mount(document.getElementById('app'), quiz, {
    report: (result) => WV.send('wv:quiz:answer', result),
    mute: () => WV.send('wv:quiz:mute'),
    onClose: () => {
      link.end();
      leave();
    },
  });
})(globalThis.WV);
