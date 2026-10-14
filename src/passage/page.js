'use strict';

// The window that stands in for a page: on the browser's own pages, in its PDF viewer and in
// the add-on stores Wordvault cannot draw anything, so "Translate with Wordvault" from the
// right-click menu shows its result here. It is the same translation popup, filling the window.

(async function (WV) {
  await WV.i18n.startPage({ reload: false }); // (the translation popup redraws itself)
  const params = new URLSearchParams(location.search);
  let text = '';
  try {
    // Handed over once by the background script (features/passage/background.js).
    text = params.get('id') ? (await WV.send('wv:passage:pending', { id: params.get('id') })) || '' : decodeURIComponent(location.hash.slice(1));
  } catch {
    text = '';
  }
  history.replaceState(null, '', location.pathname); // nothing of it stays in the address
  if (!text.trim()) {
    window.close();
    return;
  }
  try {
    const { settings } = await chrome.storage.local.get('settings');
    WV.speech.options.ttsFallback = settings?.ttsFallback === true;
  } catch {
    // the default stands
  }
  const passage = WV.passageText.isPassage(text);
  WV.popup.open({ text: passage ? text : WV.selection.tidyWord(text) || text.trim(), range: null, point: { x: 0, y: 0 }, mode: passage ? 'passage' : 'word', standalone: true });
})(globalThis.WV);
