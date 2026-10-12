// Screen text scanning, the part in the background script: take the picture of the tab and
// have it read. Reading needs a Worker and a canvas, which a Chrome service worker does not
// have, so there the picture goes to an offscreen document of the extension; Firefox's
// background page reads it itself. Either way the picture stays inside the extension, is not
// stored, and is forgotten as soon as the words are back.

import { WordvaultError } from '../../lib/errors.js';
import { getSettings } from '../../lib/settings.js';

const OFFSCREEN_PAGE = 'features/screen-ocr/offscreen.html';

/** What the browsers say when a tab may not be photographed, turned into our error codes. */
export function captureErrorCode(message) {
  const text = String(message || '');
  if (/MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND|quota|too many/i.test(text)) return 'ocr_rate';
  if (/permission|activeTab|cannot access|not allowed|cannot be (edited|captured)|chrome:\/\/|extensions gallery/i.test(text)) return 'ocr_forbidden';
  return 'ocr_capture';
}

async function capture(windowId) {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
    if (!dataUrl) throw new Error('empty capture');
    return dataUrl;
  } catch (error) {
    const detail = String(error?.message || error);
    throw new WordvaultError(captureErrorCode(detail), detail);
  }
}

/** Chrome's offscreen documents; undefined in Firefox, whose background page needs none. */
const offscreenApi = () => chrome.offscreen;
let creatingOffscreen = null;

/** Chrome: the page that reads pictures. One at a time; it closes itself when idle. */
async function ensureOffscreen() {
  const url = chrome.runtime.getURL(OFFSCREEN_PAGE);
  const open = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] });
  if (open.length > 0) return;
  creatingOffscreen ||= offscreenApi()
    .createDocument({ url: OFFSCREEN_PAGE, reasons: ['WORKERS'], justification: 'Text recognition (WebAssembly in a worker) for "Scan text on screen".' })
    .finally(() => {
      creatingOffscreen = null;
    });
  await creatingOffscreen;
}

async function readInOffscreen(request, tabId) {
  await ensureOffscreen();
  const response = await chrome.runtime.sendMessage({ type: 'wv:ocr:read', target: 'offscreen', payload: { ...request, tabId } });
  if (!response) throw new WordvaultError('ocr_engine', 'the reader did not answer');
  if (!response.ok) throw new WordvaultError(response.error?.code || 'ocr_engine', response.error?.detail || '');
  return response.data;
}

async function readHere(request, onProgress) {
  // Imported only where it can run (it starts a Worker); a Chrome service worker never gets here.
  const { readCapture } = await import('./pipeline.js');
  return readCapture(request, onProgress);
}

/**
 * @param {Object} request
 * @param {{ x: number, y: number, width: number, height: number } | null} request.area
 *        The selected area, CSS px relative to the viewport; null for everything visible.
 * @param {import('./geometry.js').Viewport} request.viewport
 * @param {{ id: number, windowId: number }} tab
 * @param {(progress: { stage: string, progress: number }) => void} [onProgress]  First called when
 *        the picture has been taken: only from then on may the page show anything over itself.
 */
export async function scanTab({ area, viewport }, tab, onProgress = () => {}) {
  const dataUrl = await capture(tab.windowId);
  onProgress({ stage: 'loading', progress: 0 });
  const settings = await getSettings();
  const request = { dataUrl, area, viewport, languages: settings.ocrLanguages, minConfidence: settings.ocrMinConfidence };
  try {
    return offscreenApi() ? await readInOffscreen(request, tab.id) : await readHere(request, onProgress);
  } catch (error) {
    if (error instanceof WordvaultError) throw error;
    throw new WordvaultError(error?.code || 'ocr_engine', String(error?.detail || error?.message || error));
  }
}
