// How a quiz gets in front of the user: the toolbar popup, a window, a card on the page, a
// notification; and falling back from one to the next when a way is not possible.

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { updateSettings } from '../src/lib/settings.js';
import { addEntry } from '../src/lib/vault.js';
import { TIMING, methodOrder } from '../src/quiz/display.js';
import { claimSession, ensureScheduled, getDiagnostics, getQuizState, openFromNotification, runScheduledQuiz, showQuiz, testQuiz } from '../src/quiz/scheduler.js';
import { readSession } from '../src/quiz/session.js';
import { createDevice, use } from './helpers/chrome.js';

const T0 = 1_790_000_000_000;
const MINUTE = 60_000;
const WORDS = ['book:kitap', 'door:kapı', 'tree:ağaç', 'water:su', 'house:ev', 'bread:ekmek', 'road:yol', 'sea:deniz', 'bird:kuş', 'cloud:bulut', 'stone:taş', 'star:yıldız'];
const POPUP_PAGE = 'quiz/quiz.html?surface=popup';
const VAULT_PAGE = 'popup/popup.html';

TIMING.CLAIM_WAIT_MS = 40; // a page that does not turn up is given up on quickly

let device;
/** The quiz pages that loaded, and what each was given to show. */
let pages;
beforeEach(async (t) => {
  device = use(createDevice('device', { uiLanguage: 'tr' }));
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  pages = [];
  // A quiz page does one thing when it has loaded: it asks for the quiz that is waiting for it.
  device.browser.onQuizPage = async (surface) => pages.push({ surface, quiz: await claimSession({ surface }) });
  for (const pair of WORDS) {
    const [text, translation] = pair.split(':');
    await addEntry({ text, translation, sourceLang: 'en', targetLang: 'tr' });
  }
});
const ways = (tried) => tried.map((way) => `${way.method}: ${way.reason}`);

test('the order: automatic is popup, window, card, notification; a chosen way goes first', () => {
  assert.deepEqual(methodOrder('auto'), ['popup', 'window', 'card', 'notification']);
  assert.deepEqual(methodOrder('popup'), ['popup', 'window', 'card', 'notification']);
  assert.deepEqual(methodOrder('window'), ['window', 'popup', 'card', 'notification']);
  assert.deepEqual(methodOrder('card'), ['card', 'popup', 'window', 'notification']);
  // the notification is only ever the last resort, and nonsense means automatic
  assert.deepEqual(methodOrder('notification'), ['popup', 'window', 'card', 'notification']);
  assert.deepEqual(methodOrder(undefined), ['popup', 'window', 'card', 'notification']);
});

test('automatic: the quiz opens in the toolbar popup, and the toolbar button goes back to the vault', async () => {
  device.browser.can = { popup: true, window: true, notification: false };
  const shown = await showQuiz();
  assert.deepEqual(shown, { reason: 'shown', method: 'popup', tried: [] });
  assert.deepEqual(device.browser.calls, [`openPopup ${POPUP_PAGE}`], 'the popup was opened showing the quiz page, and nothing else was opened');
  assert.equal(device.browser.popupPage, VAULT_PAGE, 'afterwards the button opens the vault again');
  assert.equal(pages.length, 1);
  assert.equal(pages[0].surface, 'popup');
  assert.equal(pages[0].quiz.question.choices.length, 4);
  assert.deepEqual([pages[0].quiz.index, pages[0].quiz.total, pages[0].quiz.timeoutSeconds], [1, 1, 30]);
  assert.equal(device.cards().length, 0, 'no card is put on the page as well');
  const session = await readSession();
  assert.deepEqual([session.method, session.claimed, session.id], ['popup', true, pages[0].quiz.sessionId]);
});

test('the popup is opened in the browser window the user is in', async () => {
  device.browser.can.popup = true;
  let asked = null;
  device.browser.onQuizPage = async (surface, options) => {
    asked = options;
    await claimSession({ surface });
  };
  await showQuiz();
  assert.deepEqual(asked, { windowId: 1 });
});

test('a refused popup (an older Firefox wants a click first): the quiz opens in a window instead', async () => {
  device.browser.can = { popup: true, window: true, notification: false };
  device.browser.popup.refuses = 'openPopup requires a user gesture';
  const shown = await showQuiz();
  assert.equal(shown.method, 'window');
  assert.deepEqual(shown.tried, [{ method: 'popup', reason: 'popup_refused', detail: 'openPopup requires a user gesture' }]);
  assert.equal(device.browser.popupPage, VAULT_PAGE, 'the toolbar button is not left pointing at the quiz');
  // a small window in the top right corner of the browser window (100,50, 1200 wide)
  assert.equal(device.browser.windows.length, 1);
  const { url, type, width, height, left, top, focused } = device.browser.windows[0];
  assert.deepEqual({ url, type, width, height, left, top }, { url: 'quiz/quiz.html?surface=window', type: 'popup', width: 360, height: 480, left: 100 + 1200 - 360 - 16, top: 50 + 80 });
  assert.equal(focused, undefined, 'it is opened the ordinary way, in front; an unfocused window would open behind the browser');
  assert.deepEqual(pages.map((page) => page.surface), ['window']);
  const session = await readSession();
  assert.deepEqual([session.method, session.claimed, session.windowId], ['window', true, device.browser.windows[0].id]);
});

test('a popup the browser says it opened but that never shows up does not count as shown', async () => {
  device.browser.can = { popup: true, window: true, notification: false };
  device.browser.popup.opens = false;
  const shown = await showQuiz();
  assert.equal(shown.method, 'window');
  assert.deepEqual(ways(shown.tried), ['popup: popup_not_opened']);
  assert.equal(device.browser.popupPage, VAULT_PAGE);

  // The popup's page turning up after all, when the quiz is already in the window, gets nothing.
  assert.equal(await claimSession({ surface: 'popup' }), null);
  assert.equal((await readSession()).method, 'window');
});

test('a window whose place on the screen the browser refuses is opened where the browser puts it', async () => {
  device.browser.can.window = true;
  device.browser.window.refusesPosition = true;
  const shown = await showQuiz();
  assert.equal(shown.method, 'window');
  assert.deepEqual(device.browser.calls, ['windows.create at 924,130', 'windows.create']);
  assert.equal(device.browser.windows[0].left, undefined);
});

test('a window that never loads is closed again, and the card on the page is used', async () => {
  device.browser.can.window = true;
  device.browser.window.opens = false;
  const shown = await showQuiz();
  assert.equal(shown.method, 'card');
  assert.deepEqual(ways(shown.tried), ['popup: popup_unsupported', 'window: window_not_opened']);
  assert.deepEqual(device.browser.calls, ['windows.create at 924,130', 'windows.remove']);
  assert.equal(device.browser.windows.length, 0);
  assert.equal(device.cards().length, 1);
  assert.equal((await readSession()).windowId, 0);
});

test('no popup and no window: the card on the page, as before', async () => {
  const shown = await showQuiz();
  assert.equal(shown.method, 'card');
  assert.deepEqual(ways(shown.tried), ['popup: popup_unsupported', 'window: window_unsupported']);
  const { quiz, force } = device.shows()[0].message;
  assert.equal(force, false);
  assert.deepEqual([quiz.index, quiz.total, quiz.sessionId], [1, 1, (await readSession()).id]);
  assert.deepEqual([(await readSession()).method, (await readSession()).claimed], ['card', true]);
});

test('a page that cannot show a card is no obstacle when the popup or a window can be opened', async () => {
  // the settings page before this change, a new tab, a browser page: the old "never shown"
  device.browser.page.supported = false;
  device.browser.can.popup = true;
  assert.equal((await showQuiz()).method, 'popup');

  device = use(createDevice('other', { uiLanguage: 'tr' }));
  device.browser.onQuizPage = async (surface) => pages.push({ surface, quiz: await claimSession({ surface }) });
  for (const pair of WORDS) await addEntry({ text: pair.split(':')[0], translation: pair.split(':')[1], sourceLang: 'en', targetLang: 'tr' });
  device.browser.page.supported = false;
  device.browser.can.window = true;
  assert.equal((await showQuiz()).method, 'window');
});

test('"card on the page" chosen: the card goes first, and the other ways follow where no card can be shown', async () => {
  await updateSettings({ quizDisplay: 'card' });
  device.browser.can = { popup: true, window: true, notification: false };
  let shown = await showQuiz();
  assert.deepEqual([shown.method, shown.tried.length], ['card', 0]);
  assert.deepEqual(device.browser.calls, [], 'no popup, no window');

  device = use(createDevice('other', { uiLanguage: 'tr' }));
  device.browser.onQuizPage = async (surface) => pages.push({ surface, quiz: await claimSession({ surface }) });
  for (const pair of WORDS) await addEntry({ text: pair.split(':')[0], translation: pair.split(':')[1], sourceLang: 'en', targetLang: 'tr' });
  await updateSettings({ quizDisplay: 'card' });
  device.browser.can = { popup: true, window: true, notification: false };
  device.browser.page.supported = false;
  shown = await showQuiz();
  assert.equal(shown.method, 'popup');
  assert.deepEqual(ways(shown.tried), ['card: page_not_supported']);
});

test('"separate window" chosen: the window goes first', async () => {
  await updateSettings({ quizDisplay: 'window' });
  device.browser.can = { popup: true, window: true, notification: false };
  const shown = await showQuiz();
  assert.deepEqual([shown.method, shown.tried.length], ['window', 0]);
  assert.deepEqual((await getDiagnostics()).displayOrder, ['window', 'popup', 'card', 'notification']);
});

test('nothing can show the quiz: a notification if that is allowed, otherwise it is recorded and retried', async (t) => {
  device.browser.page.supported = false;
  await ensureScheduled();
  t.mock.timers.setTime(T0 + 20 * MINUTE);
  assert.equal(await runScheduledQuiz(), 'no_display');
  let state = await getQuizState();
  assert.deepEqual(ways(state.lastSkip.tried), ['popup: popup_unsupported', 'window: window_unsupported', 'card: page_not_supported', 'notification: notification_not_allowed']);
  assert.equal(state.nextQuizAt, T0 + 23 * MINUTE, 'tried again in a few minutes');
  assert.equal(await readSession(), null, 'no quiz is left waiting');
  assert.deepEqual(state.recent, [], 'and no word counts as asked');

  // with the notification permission
  device.browser.can.notification = true;
  t.mock.timers.setTime(T0 + 23 * MINUTE);
  assert.equal(await runScheduledQuiz(), 'shown');
  state = await getQuizState();
  assert.equal(state.lastShown.method, 'notification');
  assert.equal(state.nextQuizAt, T0 + 43 * MINUTE, 'the regular rhythm');
  assert.deepEqual(device.browser.notifications.map((n) => [n.id, n.type, n.title, n.message, n.iconUrl]), [['wv:quiz', 'basic', 'quizNotificationTitle', 'quizNotificationText', 'test-extension://icons/icon-96.png']]);
  assert.equal((await getDiagnostics()).notifications, true);

  // Clicking it opens the quiz in a window (which this browser can now open).
  device.browser.can.window = true;
  const opened = await openFromNotification();
  assert.deepEqual([opened.reason, opened.method], ['shown', 'window']);
  assert.deepEqual(pages.map((page) => page.surface), ['window']);
});

test('the notification can be tried from the settings without waiting for everything else to fail', async () => {
  device.browser.can = { popup: true, window: true, notification: false };
  let tried = await testQuiz({ methods: ['notification'] });
  assert.deepEqual([tried.ok, tried.reason, ways(tried.tried)], [false, 'no_display', ['notification: notification_not_allowed']]);
  device.browser.can.notification = true;
  tried = await testQuiz({ methods: ['notification'] });
  assert.deepEqual([tried.ok, tried.method], [true, 'notification']);
  assert.deepEqual(device.browser.calls, ['notifications.create'], 'only the notification: no popup, no window');
  // names that are not ways of showing a quiz are ignored, which leaves the ordinary order
  tried = await testQuiz({ methods: ['nonsense'] });
  assert.equal(tried.method, 'popup');
});

test('a notification nobody clicks does not hold up the next quiz', async (t) => {
  device.browser.page.supported = false;
  device.browser.can.notification = true;
  await ensureScheduled();
  t.mock.timers.setTime(T0 + 20 * MINUTE);
  assert.equal(await runScheduledQuiz(), 'shown');
  device.browser.page.supported = true;
  t.mock.timers.setTime(T0 + 40 * MINUTE);
  assert.equal(await runScheduledQuiz(), 'shown');
  assert.equal((await getQuizState()).lastShown.method, 'card');
});

test('a bad moment holds every way back, not only the card', async () => {
  device.browser.can = { popup: true, window: true, notification: true };
  for (const blocked of ['typing', 'video_playing', 'fullscreen', 'popup_open']) {
    device.browser.page.blocked = blocked;
    const shown = await showQuiz();
    assert.deepEqual(shown, { reason: blocked, method: '', tried: [] });
  }
  device.browser.page.blocked = '';
  device.browser.focused = false;
  assert.equal((await showQuiz()).reason, 'window_not_focused');
  assert.deepEqual(device.browser.calls, [], 'nothing was opened, no notification was sent');
  assert.equal(await readSession(), null);
});

test('"Test now" goes the same way as the timer, whatever the moment', async () => {
  device.browser.can = { popup: true, window: true, notification: false };
  device.browser.page.blocked = 'video_playing';
  let tested = await testQuiz();
  assert.deepEqual([tested.ok, tested.method], [true, 'popup']);

  // The browser window is not in front: the popup cannot open there, the window can.
  device.browser.focused = false;
  tested = await testQuiz();
  assert.deepEqual([tested.ok, tested.method, ways(tested.tried)], [true, 'window', ['popup: window_not_focused']]);

  // As a card, it appears even though the page says this is a bad moment.
  await updateSettings({ quizDisplay: 'card' });
  tested = await testQuiz();
  assert.deepEqual([tested.ok, tested.method, device.shows().at(-1).message.force], [true, 'card', true]);
  assert.equal((await getQuizState()).lastShown, null, 'none of this is recorded as the timer\'s doing');
});

test('"Test now" while a quiz window is open: the old window is closed, not left behind', async () => {
  await updateSettings({ quizDisplay: 'window' });
  device.browser.can.window = true;
  await showQuiz();
  const first = device.browser.windows[0].id;
  assert.equal((await testQuiz()).method, 'window');
  assert.deepEqual(device.browser.windows.map((window) => window.id), [first + 1]);
});

test('a quiz page opened by hand, with no quiz waiting, is given nothing', async () => {
  assert.equal(await claimSession({ surface: 'popup' }), null);
  assert.equal(await claimSession({ surface: 'window' }), null);
  // nor is a quiz that is already on screen handed out a second time
  device.browser.can.popup = true;
  await showQuiz();
  assert.equal(pages.length, 1);
  assert.equal(await claimSession({ surface: 'popup' }), null);
});

test('the panel is told which way the timer used and why the others were not', async (t) => {
  device.browser.can = { popup: true, window: true, notification: false };
  device.browser.popup.refuses = 'Cannot show popup for an inactive window';
  await ensureScheduled();
  t.mock.timers.setTime(T0 + 20 * MINUTE);
  assert.equal(await runScheduledQuiz(), 'shown');
  const d = await getDiagnostics();
  assert.deepEqual(d.lastShown, { at: T0 + 20 * MINUTE, method: 'window', tried: [{ method: 'popup', reason: 'popup_refused', detail: 'Cannot show popup for an inactive window' }] });
  assert.deepEqual([d.display, d.displayOrder], ['auto', ['popup', 'window', 'card', 'notification']]);
});
