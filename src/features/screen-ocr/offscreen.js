// Chrome only: the offscreen document. A service worker can neither start a Worker nor draw on
// a canvas the way text recognition needs, so the background script hands the picture to this
// invisible page of the extension. It answers with words and boxes, never with the picture.

import { serializeError } from '../../lib/errors.js';
import { onIdle, readCapture } from './pipeline.js';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== 'offscreen' || message.type !== 'wv:ocr:read' || sender.id !== chrome.runtime.id) return false;
  const { tabId, ...request } = message.payload;
  readCapture(request, (progress) => {
    // This page cannot talk to tabs; the background script passes the progress on.
    chrome.runtime.sendMessage({ type: 'wv:ocr:progress', payload: { tabId, ...progress } }).catch(() => {});
  }).then(
    (data) => sendResponse({ ok: true, data }),
    (error) => sendResponse({ ok: false, error: serializeError(error) }),
  );
  return true;
});

// Nothing to read for a minute: the engine has given its memory back, and this page goes too.
onIdle(() => window.close());
