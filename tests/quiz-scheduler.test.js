// The quiz timer: when a quiz is planned, what happens when it is due, and that the reason is
// always recorded when none is shown.

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { updateSettings } from '../src/lib/settings.js';
import { addEntry } from '../src/lib/vault.js';
import { ALARM_NAME, RETRY_MINUTES, ensureScheduled, getDiagnostics, getQuizState, runScheduledQuiz, showQuiz, testQuiz } from '../src/quiz/scheduler.js';
import { createDevice, use } from './helpers/chrome.js';

const T0 = 1_790_000_000_000;
const MINUTE = 60_000;
const WORDS = ['book:kitap', 'door:kapı', 'tree:ağaç', 'water:su', 'house:ev', 'bread:ekmek', 'road:yol', 'sea:deniz', 'bird:kuş', 'cloud:bulut', 'stone:taş', 'star:yıldız'];

let device;
beforeEach(async (t) => {
  device = use(createDevice('device', { uiLanguage: 'tr' }));
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
});
const at = (t, time) => t.mock.timers.setTime(time);
const fill = async (count = WORDS.length) => {
  for (const pair of WORDS.slice(0, count)) {
    const [text, translation] = pair.split(':');
    await addEntry({ text, translation, sourceLang: 'en', targetLang: 'tr' });
  }
};
const alarmAt = () => device.alarmTimes()[ALARM_NAME];
/** The browser's part: the clock reaches the alarm, the alarm fires, the extension handles it. */
async function alarmGoesOff(t) {
  at(t, alarmAt());
  assert.equal(device.fireAlarm(ALARM_NAME), true, 'there is an alarm to fire');
  return runScheduledQuiz();
}

test('the timer is set as soon as the extension starts, one interval ahead', async () => {
  await ensureScheduled();
  assert.equal(alarmAt(), T0 + 20 * MINUTE);
  assert.equal((await getQuizState()).sonrakiQuizZamani, T0 + 20 * MINUTE);
});

test('starting again keeps the plan instead of pushing it further away', async (t) => {
  await ensureScheduled();
  at(t, T0 + 12 * MINUTE);
  await ensureScheduled();
  await ensureScheduled();
  assert.equal(alarmAt(), T0 + 20 * MINUTE);
  assert.equal(device.browser.alarmsCreated.length, 1, 'and the alarm is not created over and over');
});

test('after a browser restart the alarm is put back from the stored time', async (t) => {
  await ensureScheduled();
  device.forgetAlarms();
  assert.equal(alarmAt(), undefined);
  at(t, T0 + 5 * MINUTE);
  await ensureScheduled();
  assert.equal(alarmAt(), T0 + 20 * MINUTE);
});

test('a quiz that came due while the browser was closed is shown soon, once', async (t) => {
  await ensureScheduled();
  device.forgetAlarms();
  at(t, T0 + 3 * 60 * MINUTE);
  await ensureScheduled();
  assert.equal(alarmAt(), T0 + 3 * 60 * MINUTE + 30_000, 'at the next opportunity, not in the past');
  assert.equal(Object.keys(device.alarmTimes()).length, 1);
});

test('switched off: no alarm, and the plan is cleared', async () => {
  await ensureScheduled();
  await updateSettings({ quizEnabled: false });
  await ensureScheduled();
  assert.equal(alarmAt(), undefined);
  assert.equal((await getQuizState()).sonrakiQuizZamani, 0);
  assert.equal(await runScheduledQuiz(), 'disabled');
  assert.equal(alarmAt(), undefined);

  await updateSettings({ quizEnabled: true });
  await ensureScheduled();
  assert.equal(alarmAt(), T0 + 20 * MINUTE);
});

test('switched off from the start: no alarm is ever set', async () => {
  await updateSettings({ quizEnabled: false });
  await fill();
  await ensureScheduled();
  await ensureScheduled();
  assert.equal(device.browser.alarmsCreated.length, 0);
  assert.equal(alarmAt(), undefined);
  assert.equal((await getDiagnostics()).alarmAt, 0);
});

test('changing the frequency rebuilds the timer at once, counting from now', async (t) => {
  await ensureScheduled();
  assert.equal(alarmAt(), T0 + 20 * MINUTE);

  at(t, T0 + 3 * MINUTE);
  await updateSettings({ quizIntervalMinutes: 5 });
  await ensureScheduled();
  assert.equal(alarmAt(), T0 + 8 * MINUTE, 'shorter: five minutes from the change, not the old twenty');
  assert.equal((await getQuizState()).sonrakiQuizZamani, T0 + 8 * MINUTE);

  at(t, T0 + 4 * MINUTE);
  await updateSettings({ quizIntervalMinutes: 60 });
  await ensureScheduled();
  assert.equal(alarmAt(), T0 + 64 * MINUTE, 'longer: an hour from the change, not the four minutes that were left');

  // the same setting again changes nothing
  at(t, T0 + 30 * MINUTE);
  await updateSettings({ quizIntervalMinutes: 60 });
  await ensureScheduled();
  assert.equal(alarmAt(), T0 + 64 * MINUTE);
});

test('the frequency is used as a whole number of minutes between one minute and a day', async () => {
  for (const [setting, minutes] of [[1, 1], [7.4, 7], [240, 240], [100_000, 1440], [0, 20], [-5, 20], ['abc', 20], [null, 20], [0.2, 20]]) {
    device = use(createDevice('device', { uiLanguage: 'tr' }));
    await updateSettings({ quizIntervalMinutes: setting });
    await ensureScheduled();
    assert.equal(alarmAt(), T0 + minutes * MINUTE, `setting ${JSON.stringify(setting)}`);
    assert.equal((await getDiagnostics()).intervalMinutes, minutes);
  }
});

test('a due quiz is sent to the active tab; the next one is a full interval later', async (t) => {
  await fill();
  await ensureScheduled();
  assert.equal(await alarmGoesOff(t), 'shown');
  assert.equal(device.browser.sent.length, 1);
  const { tabId, message, options } = device.browser.sent[0];
  assert.deepEqual([tabId, message.type, message.force, options], [1, 'wv:quiz:show', false, { frameId: 0 }]);
  assert.equal(message.payload.choices.length, 4);
  assert.equal(alarmAt(), T0 + 40 * MINUTE);
  const state = await getQuizState();
  assert.deepEqual(state.lastAttempt, { at: T0 + 20 * MINUTE, reason: 'shown' });
  assert.deepEqual(state.lastShown, { at: T0 + 20 * MINUTE });
  assert.equal(state.lastSkip, null);
});

test('after every quiz, shown or not, the next one is set', async (t) => {
  await fill();
  await updateSettings({ quizIntervalMinutes: 10 });
  await ensureScheduled();
  const replies = [{ shown: true }, { shown: false, reason: 'typing' }, { shown: true }, { shown: false, reason: 'video_playing' }, { shown: false, reason: 'fullscreen' }, { shown: true }, { shown: true }];
  let expected = T0 + 10 * MINUTE;
  for (const [round, reply] of replies.entries()) {
    device.browser.reply = () => reply;
    assert.equal(alarmAt(), expected, `round ${round}: the alarm is where the plan says`);
    const reason = await alarmGoesOff(t);
    assert.equal(reason, reply.shown ? 'shown' : reply.reason);
    expected += (reply.shown ? 10 : RETRY_MINUTES) * MINUTE;
    assert.equal((await getQuizState()).sonrakiQuizZamani, expected);
    assert.equal(device.alarm(ALARM_NAME).periodInMinutes, 10);
  }
  assert.equal(alarmAt(), expected, 'and after the last one too');
  assert.equal(device.browser.sent.length, replies.length, 'every due quiz reached the page');
});

test('the alarm repeats, so a run that was cut short does not silence the timer', async (t) => {
  await fill();
  await updateSettings({ quizIntervalMinutes: 15 });
  await ensureScheduled();
  assert.equal(device.alarm(ALARM_NAME).periodInMinutes, 15);

  // The alarm fires, and the background script is stopped before it has done anything.
  at(t, alarmAt());
  device.fireAlarm(ALARM_NAME);
  assert.equal(alarmAt(), T0 + 30 * MINUTE, 'the browser still holds the alarm, one period on');

  // The next firing finds the plan overdue and shows the quiz.
  assert.equal(await alarmGoesOff(t), 'shown');
  assert.equal(alarmAt(), T0 + 45 * MINUTE);
  assert.equal(device.alarm(ALARM_NAME).periodInMinutes, 15);
});

test('an alarm that goes off before the planned time shows nothing', async (t) => {
  await fill();
  await ensureScheduled();
  at(t, T0 + 5 * MINUTE);
  assert.equal(await runScheduledQuiz(), 'not_due');
  assert.equal(device.browser.sent.length, 0);
  assert.equal(alarmAt(), T0 + 20 * MINUTE, 'the plan stands');
  assert.equal((await getQuizState()).lastAttempt, null);
});

test('waking up for a due quiz: the start-up check and the quiz do not undo each other', async (t) => {
  await fill();
  for (const order of ['check first', 'quiz first']) {
    device = use(createDevice(order, { uiLanguage: 'tr' }));
    await fill();
    at(t, T0);
    await ensureScheduled();
    at(t, T0 + 20 * MINUTE);
    device.fireAlarm(ALARM_NAME);
    // Both start at the same moment, as they do when the alarm wakes the background script up.
    const both = order === 'check first' ? [ensureScheduled(), runScheduledQuiz()] : [runScheduledQuiz(), ensureScheduled()];
    const results = await Promise.all(both);
    assert.ok(results.includes('shown'), order);
    assert.equal(device.browser.sent.length, 1, `${order}: one quiz`);
    assert.equal(alarmAt(), T0 + 40 * MINUTE, `${order}: the alarm is one interval ahead, not left at "as soon as possible"`);
    assert.equal((await getQuizState()).sonrakiQuizZamani, T0 + 40 * MINUTE);
  }
});

test('too few words or meanings: nothing is sent and the reason is recorded', async () => {
  await fill(9);
  assert.equal(await runScheduledQuiz(), 'below_min_cards');
  assert.equal(device.browser.sent.length, 0);
  assert.equal(alarmAt(), T0 + 20 * MINUTE, 'checked again at the regular interval');
  const state = await getQuizState();
  assert.deepEqual(state.lastAttempt, { at: T0, reason: 'below_min_cards' });
  assert.deepEqual(state.lastSkip, { at: T0, reason: 'below_min_cards' });
  assert.equal(state.lastShown, null);

  device = use(createDevice('other', { uiLanguage: 'tr' }));
  await updateSettings({ quizMinCards: 2 });
  await fill(3);
  assert.equal(await runScheduledQuiz(), 'not_enough_choices');
  assert.equal(device.browser.sent.length, 0);
});

test('a bad moment does not skip the quiz: it is tried again a few minutes later', async (t) => {
  await fill();
  const scenes = [
    ['no_active_tab', () => { device.browser.tab = null; }],
    ['window_not_focused', () => { device.browser.focused = false; }],
    ['media_playing', () => { device.browser.tab.audible = true; }],
    ['video_playing', () => { device.browser.reply = () => ({ shown: false, reason: 'video_playing' }); }],
    ['typing', () => { device.browser.reply = () => ({ shown: false, reason: 'typing' }); }],
    ['fullscreen', () => { device.browser.reply = () => ({ shown: false, reason: 'fullscreen' }); }],
    ['popup_open', () => { device.browser.reply = () => ({ shown: false, reason: 'popup_open' }); }],
    ['page_not_supported', () => { device.browser.reply = () => { throw new Error('Could not establish connection. Receiving end does not exist.'); }; }],
  ];
  let now = T0;
  for (const [expected, setScene] of scenes) {
    device.browser.tab = { id: 1, windowId: 1, active: true, audible: false };
    device.browser.focused = true;
    device.browser.reply = () => ({ shown: true });
    setScene();
    now += 10 * MINUTE;
    at(t, now);
    assert.equal(await runScheduledQuiz(), expected);
    assert.equal(alarmAt(), now + RETRY_MINUTES * MINUTE, `${expected}: retried soon`);
    assert.deepEqual((await getQuizState()).lastAttempt, { at: now, reason: expected });
    assert.deepEqual((await getQuizState()).lastSkip, { at: now, reason: expected });
  }
  // The scene clears: the retry shows the quiz and the regular rhythm resumes.
  device.browser.reply = () => ({ shown: true });
  at(t, now + RETRY_MINUTES * MINUTE);
  assert.equal(await runScheduledQuiz(), 'shown');
  assert.equal(alarmAt(), now + RETRY_MINUTES * MINUTE + 20 * MINUTE);
  assert.equal((await getQuizState()).lastSkip.reason, 'page_not_supported', 'the last skip stays on record next to the last quiz shown');
});

test('with a short interval the retry is not later than the interval itself', async (t) => {
  await fill();
  await updateSettings({ quizIntervalMinutes: 1 });
  await ensureScheduled();
  device.browser.reply = () => ({ shown: false, reason: 'typing' });
  assert.equal(await alarmGoesOff(t), 'typing');
  assert.equal(alarmAt(), T0 + 2 * MINUTE);
});

test('only one tab is ever asked, and only its top frame', async (t) => {
  await fill();
  await ensureScheduled();
  await alarmGoesOff(t);
  await alarmGoesOff(t);
  assert.ok(device.browser.sent.every((sent) => sent.tabId === 1 && sent.options.frameId === 0));
  assert.equal(device.browser.sent.length, 2);
});

test('the diagnostics say what the panel needs to know', async (t) => {
  await fill(9);
  await ensureScheduled();
  let d = await getDiagnostics();
  assert.deepEqual(
    { enabled: d.enabled, intervalMinutes: d.intervalMinutes, total: d.total, minCards: d.minCards, askable: d.askable, meanings: d.meanings, targetLang: d.targetLang, standingReason: d.standingReason, nextAt: d.nextAt, alarmAt: d.alarmAt, lastAttempt: d.lastAttempt, lastShown: d.lastShown, lastSkip: d.lastSkip },
    { enabled: true, intervalMinutes: 20, total: 9, minCards: 10, askable: 9, meanings: 9, targetLang: 'tr', standingReason: 'below_min_cards', nextAt: T0 + 20 * MINUTE, alarmAt: T0 + 20 * MINUTE, lastAttempt: null, lastShown: null, lastSkip: null },
  );

  await fill();
  device.browser.reply = () => ({ shown: false, reason: 'video_playing' });
  at(t, T0 + 20 * MINUTE);
  await runScheduledQuiz();
  d = await getDiagnostics();
  assert.equal(d.standingReason, '');
  assert.deepEqual(d.lastAttempt, { at: T0 + 20 * MINUTE, reason: 'video_playing' });
  assert.deepEqual(d.lastSkip, { at: T0 + 20 * MINUTE, reason: 'video_playing' });
  assert.equal(d.nextAt, T0 + (20 + RETRY_MINUTES) * MINUTE);

  device.browser.reply = () => ({ shown: true });
  at(t, d.nextAt);
  await runScheduledQuiz();
  d = await getDiagnostics();
  assert.deepEqual(d.lastShown, { at: T0 + (20 + RETRY_MINUTES) * MINUTE });

  device.forgetAlarms();
  assert.equal((await getDiagnostics()).alarmAt, 0, 'a missing alarm is visible');

  await updateSettings({ quizEnabled: false });
  assert.equal((await getDiagnostics()).standingReason, 'disabled');
});

test('"Test now" shows a quiz the way the timer does, whatever the timer, the switch and the moment say', async () => {
  await updateSettings({ quizEnabled: false });
  await fill(4);
  device.browser.focused = false;
  device.browser.tab.audible = true;
  assert.deepEqual(await testQuiz(), { ok: true });
  assert.equal(device.browser.sent.length, 1, 'it goes to the active tab like any quiz');
  const { message, options } = device.browser.sent[0];
  assert.deepEqual([message.type, message.force, options], ['wv:quiz:show', true, { frameId: 0 }]);
  assert.equal(message.payload.choices.length, 4);
  assert.equal(alarmAt(), undefined, 'the plan is not touched');
  const state = await getQuizState();
  assert.deepEqual([state.sonrakiQuizZamani, state.lastAttempt, state.lastShown, state.lastSkip], [0, null, null, null], 'nor is the record of what the timer did');

  // what can still stand in the way is reported instead of failing silently
  device.browser.reply = () => { throw new Error('Could not establish connection. Receiving end does not exist.'); };
  assert.deepEqual(await testQuiz(), { ok: false, reason: 'page_not_supported' });
  device.browser.tab = null;
  assert.deepEqual(await testQuiz(), { ok: false, reason: 'no_active_tab' });

  device = use(createDevice('small', { uiLanguage: 'tr' }));
  await fill(3);
  assert.deepEqual(await testQuiz(), { ok: false, reason: 'not_enough_choices' });
  assert.equal(device.browser.sent.length, 0);
});

test('an unexpected failure becomes the recorded reason instead of stopping the timer', async () => {
  await fill();
  device.chrome.tabs.query = async () => { throw new Error('tabs unavailable'); };
  const reason = await runScheduledQuiz();
  assert.match(reason, /^error: tabs unavailable/);
  assert.equal(alarmAt(), T0 + 20 * MINUTE);
  assert.equal((await getQuizState()).lastAttempt.reason, reason);
});

test('the card is told how long to wait for an answer', async () => {
  await fill();
  await showQuiz();
  assert.equal(device.browser.sent.at(-1).message.timeoutSeconds, 30, 'thirty seconds unless set otherwise');
  await testQuiz();
  assert.equal(device.browser.sent.at(-1).message.timeoutSeconds, 30, '"Test now" shows the same card');

  for (const [setting, expected] of [[45, 45], [12.4, 12], [1, 5], [100_000, 300], [0, 30], [-3, 30], ['abc', 30], [null, 30]]) {
    await updateSettings({ quizTimeoutSeconds: setting });
    await showQuiz();
    assert.equal(device.browser.sent.at(-1).message.timeoutSeconds, expected, `setting ${JSON.stringify(setting)}`);
    await testQuiz();
    assert.equal(device.browser.sent.at(-1).message.timeoutSeconds, expected);
  }
});
