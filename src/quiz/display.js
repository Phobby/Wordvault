// The ways a quiz can be put in front of the user, and falling back from one to the next.
//
//   popup         the extension's toolbar popup, opened by the extension (action.openPopup)
//   window        a small window of its own (windows.create)
//   card          a card in the top right corner of the page the user is on (content/quiz.js)
//   notification  a system notification; the quiz opens in a window when it is clicked
//
// What browsers allow, as tried in Chromium 141, Firefox 157 and Zen 1.23 (Firefox 157) on macOS:
//   - action.openPopup() works from an alarm, without a user gesture, in Chrome 127+ and
//     Firefox 149+ (older Firefox versions insist on a gesture and refuse). The browser window
//     has to have the focus. The popup takes the keyboard focus and closes as soon as the user
//     clicks anywhere else.
//   - windows.create({ type: 'popup' }) works everywhere on the desktop. `focused: false` is of
//     no use: Firefox ignores it (the window takes the focus anyway), and Chrome on macOS opens
//     such a window *behind* the browser window, where nobody sees it. So the quiz window is
//     opened focused. Chrome refuses a position that is mostly off screen; then the browser
//     places the window.
//   - the card needs a page that content scripts run on; it leaves the focus where it is.

import { updateSession, viewOf } from './session.js';

export const METHODS = Object.freeze(['popup', 'window', 'card', 'notification']);
/** The values of the "how the quiz appears" setting. */
export const PREFERENCES = Object.freeze(['auto', 'popup', 'window', 'card']);
const QUIZ_PAGE = 'quiz/quiz.html';
export const NOTIFICATION_ID = 'wv:quiz';
/** Size of the quiz window, and where it sits inside the browser window it belongs to. */
const WINDOW = Object.freeze({ WIDTH: 360, HEIGHT: 480, MARGIN_RIGHT: 16, MARGIN_TOP: 80 });

/** Tests shorten the wait. */
export const TIMING = {
  /** How long a popup or window gets to load and ask for the quiz before it counts as "did not open". */
  CLAIM_WAIT_MS: 2500,
};

/**
 * The order in which the ways are tried.
 * ASSUMPTION: a chosen way goes first and the others follow in the automatic order, so that
 * choosing "card on the page" still gets a quiz on a page that cannot show a card.
 * @param {string} preference  One of PREFERENCES.
 */
export function methodOrder(preference) {
  return METHODS.includes(preference) && preference !== 'notification' ? [preference, ...METHODS.filter((method) => method !== preference)] : [...METHODS];
}

// --- Waiting for the page that shows the quiz ---------------------------------------------------
// Opening a popup or a window only says that the browser took the request. That the quiz is
// really there is known when its page asks for the question. Whoever opened it waits for that
// here. This lives in memory on purpose: the wait is a couple of seconds within one burst of
// activity of the background script, and if the script were stopped in the middle, the stored
// quiz would simply never be picked up and the next one would replace it.

const waiting = new Map();

function waitForClaim(sessionId) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      waiting.delete(sessionId);
      resolve(false);
    }, TIMING.CLAIM_WAIT_MS);
    waiting.set(sessionId, (claimed) => {
      clearTimeout(timer);
      waiting.delete(sessionId);
      resolve(claimed);
    });
  });
}

/** The page showing the quiz has picked it up. */
export function sessionClaimed(sessionId) {
  waiting.get(sessionId)?.(true);
}

/** Nothing was opened after all, so no page will come. */
function stopWaiting(sessionId) {
  waiting.get(sessionId)?.(false);
}

const detailOf = (error) => String(error?.message || error).slice(0, 160);
const failed = (reason, error) => ({ reason, ...(error === undefined ? {} : { detail: detailOf(error) }) });

// --- The ways ------------------------------------------------------------------------------------

/** A: the toolbar popup, showing the quiz page instead of the vault for this one opening. */
async function inPopup(session, scene) {
  if (typeof chrome.action?.openPopup !== 'function') return failed('popup_unsupported');
  if (!scene.window?.focused) return failed('window_not_focused');
  const usual = chrome.runtime.getManifest().action?.default_popup || '';
  const claimed = waitForClaim(session.id);
  try {
    await chrome.action.setPopup({ popup: `${QUIZ_PAGE}?surface=popup` });
    await chrome.action.openPopup({ windowId: scene.window.id });
  } catch (error) {
    stopWaiting(session.id);
    await chrome.action.setPopup({ popup: usual }).catch(() => {});
    return failed('popup_refused', error);
  }
  const opened = await claimed;
  // The toolbar button goes back to opening the vault.
  await chrome.action.setPopup({ popup: usual }).catch(() => {});
  return opened ? null : failed('popup_not_opened');
}

function createQuizWindow(anchor) {
  const data = { url: `${QUIZ_PAGE}?surface=window`, type: 'popup', width: WINDOW.WIDTH, height: WINDOW.HEIGHT };
  const placed = [anchor?.left, anchor?.top, anchor?.width].every(Number.isFinite);
  if (!placed) return chrome.windows.create(data);
  // ASSUMPTION: "top right of the screen" is taken as the top right corner of the browser window
  // the user is in. The screen itself cannot be measured from here without one more permission,
  // and with the browser maximized the two are the same place.
  const position = { left: Math.round(anchor.left + anchor.width - WINDOW.WIDTH - WINDOW.MARGIN_RIGHT), top: Math.round(anchor.top + WINDOW.MARGIN_TOP) };
  return chrome.windows.create({ ...data, ...position }).catch(() => chrome.windows.create(data));
}

/**
 * B: a small window of its own.
 * ASSUMPTION: the window is opened the ordinary way, with the focus, although the specification
 * asks to try `focused: false`: that was tried, and it either changes nothing (Firefox) or hides
 * the window behind the browser (Chrome on macOS); see the top of this file.
 */
async function inWindow(session, scene) {
  if (typeof chrome.windows?.create !== 'function') return failed('window_unsupported');
  const claimed = waitForClaim(session.id);
  let created;
  try {
    created = await createQuizWindow(scene.window);
  } catch (error) {
    stopWaiting(session.id);
    return failed('window_refused', error);
  }
  await updateSession(session.id, { windowId: created.id });
  if (await claimed) return null;
  await chrome.windows.remove(created.id).catch(() => {});
  await updateSession(session.id, { windowId: 0 });
  return failed('window_not_opened');
}

/** C: the card on the page. The page's answer is what tells that it is there. */
async function onPage(session, scene, { forced }) {
  if (!scene.tab || !scene.page) return failed('page_not_supported');
  const message = { type: 'wv:quiz:show', quiz: viewOf(session), force: Boolean(forced) };
  const reply = await chrome.tabs.sendMessage(scene.tab.id, message, { frameId: 0 }).catch(() => null);
  // No reply: a page extensions cannot run on (browser pages, the add-on store ...).
  if (!reply?.shown) return failed(reply?.reason || 'page_not_supported');
  await updateSession(session.id, { claimed: true, touchedAt: Date.now() });
  return null;
}

/** Whether the user has allowed system notifications (an optional permission). */
export async function notificationsAllowed() {
  try {
    return Boolean(chrome.notifications) && (await chrome.permissions.contains({ permissions: ['notifications'] }));
  } catch {
    return false;
  }
}

/**
 * D: a system notification. The quiz itself opens when it is clicked.
 * ASSUMPTION: sending the notification counts as the quiz having been shown (the next one comes
 * after the regular interval), and a notification nobody clicks does not hold the next quiz up.
 */
async function byNotification() {
  if (!(await notificationsAllowed())) return failed('notification_not_allowed');
  try {
    await chrome.notifications.create(NOTIFICATION_ID, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon-96.png'),
      title: chrome.i18n.getMessage('quizNotificationTitle'),
      message: chrome.i18n.getMessage('quizNotificationText'),
    });
  } catch (error) {
    return failed('notification_refused', error);
  }
  return null;
}

const WAYS = { popup: inPopup, window: inWindow, card: onPage, notification: byNotification };

/**
 * Shows the quiz in the first way that works.
 *
 * @param {import('./session.js').QuizSession} session  Already stored.
 * @param {{ window: object | null, tab: object | null, page: boolean }} scene
 *   The browser window in front, its active tab, and whether the page in it can be talked to.
 * @param {Object} options
 * @param {string[]} options.methods   The ways to try, in order (see methodOrder).
 * @param {boolean} [options.forced]   "Test now": the card appears whatever the page is doing.
 * @returns {Promise<{ method: string, tried: { method: string, reason: string, detail?: string }[] }>}
 *   `method`: the way that worked, '' if none did. `tried`: the ways that did not, with the reason.
 */
export async function display(session, scene, { methods, forced = false }) {
  const tried = [];
  for (const method of methods) {
    // A page that turns up late for a way that has been given up on is told there is no quiz.
    await updateSession(session.id, { offeredTo: method });
    let failure;
    try {
      failure = await WAYS[method](session, scene, { forced });
    } catch (error) {
      failure = failed('error', error);
    }
    if (!failure) return { method, tried };
    tried.push({ method, ...failure });
  }
  return { method: '', tried };
}
