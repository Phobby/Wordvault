'use strict';

// Screen text scanning, the part in the page: choose an area, ask the background script to
// photograph and read it, lay the text over the place it was read from. The picture is taken
// and handled in the extension's own context; only the words and their boxes come back here.

(function (WV) {
  // Top frame only: the screenshot is of the whole tab, and so is the selection.
  if (!WV.supported || !WV.ocrSelector || WV.screenOcr || window.top !== window) return;
  const { t } = WV;

  const LAST_AREA_KEY = 'ocrLastArea';
  const ERROR_MESSAGES = {
    ocr_forbidden: 'ocrErrForbidden',
    ocr_rate: 'ocrErrRate',
    ocr_capture: 'ocrErrCapture',
    ocr_no_text: 'ocrErrNoText',
    context_invalidated: 'errContextInvalidated',
  };

  let busy = false;
  let pending = null; // the area being read

  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

  /** What the page knows about its viewport; the background script measures the rest from the picture. */
  function viewportNow() {
    const visual = window.visualViewport;
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
      scale: visual?.scale || 1,
      offsetLeft: visual?.offsetLeft || 0,
      offsetTop: visual?.offsetTop || 0,
    };
  }

  async function rememberedArea() {
    try {
      const stored = await chrome.storage.local.get(['settings', LAST_AREA_KEY]);
      return stored.settings?.ocrRememberArea === true ? stored[LAST_AREA_KEY] || null : null;
    } catch {
      return null;
    }
  }

  async function start() {
    if (busy || WV.ocrSelector.isOpen()) return;
    WV.popup?.close();
    WV.ocrLayer.hide();
    const chosen = await WV.ocrSelector.choose({ initial: await rememberedArea() });
    if (chosen === undefined) return; // cancelled

    const viewport = viewportNow();
    const area = chosen || { x: 0, y: 0, width: viewport.innerWidth, height: viewport.innerHeight };
    if (chosen) chrome.storage.local.set({ [LAST_AREA_KEY]: chosen }).catch(() => {});
    busy = true;
    pending = area;
    try {
      // The selector is off the page now, but not yet off the screen: the picture is taken
      // only after the browser has drawn the page without it.
      await nextFrame();
      await nextFrame();
      const result = await WV.send('wv:ocr:scan', { area: chosen, viewport });
      if (result.words.length === 0) WV.ocrLayer.showError(result.area, t('ocrErrNoText'));
      else WV.ocrLayer.showResult(result);
    } catch (error) {
      WV.ocrLayer.showError(area, t(ERROR_MESSAGES[error?.code] || 'ocrErrCapture'));
    } finally {
      busy = false;
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'wv:ocr:start') start();
    // The picture has been taken: from here on something may be shown over the page again.
    else if (message?.type === 'wv:ocr:stage' && busy && message.stage === 'reading') {
      const viewport = viewportNow();
      WV.ocrLayer.showBusy(pending || { x: 0, y: 0, width: viewport.innerWidth, height: viewport.innerHeight });
    }
    return false;
  });

  WV.screenOcr = { start };
})(globalThis.WV);
