// The quiz timer: when a quiz is planned, what happens when it is due, and that the reason is
// always recorded when none is shown.

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { updateSettings } from '../src/lib/settings.js';
import { addEntry } from '../src/lib/vault.js';
import { ALARM_NAME, RETRY_MINUTES, buildTestQuestion, ensureScheduled, getDiagnostics, getQuizState, runScheduledQuiz } from '../src/quiz/scheduler.js';
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

test('a due quiz is sent to the active tab; the next one is a full interval later', async () => {
  await fill();
  assert.equal(await runScheduledQuiz(), 'shown');
  assert.equal(device.browser.sent.length, 1);
  const { tabId, message, options } = device.browser.sent[0];
  assert.deepEqual([tabId, message.type, options], [1, 'wv:quiz:show', { frameId: 0 }]);
  assert.equal(message.payload.choices.length, 4);
  assert.equal(alarmAt(), T0 + 20 * MINUTE);
  assert.deepEqual((await getQuizState()).lastAttempt, { at: T0, reason: 'shown' });
});

test('too few words or meanings: nothing is sent and the reason is recorded', async () => {
  await fill(9);
  assert.equal(await runScheduledQuiz(), 'below_min_cards');
  assert.equal(device.browser.sent.length, 0);
  assert.equal(alarmAt(), T0 + 20 * MINUTE, 'checked again at the regular interval');
  assert.deepEqual((await getQuizState()).lastAttempt, { at: T0, reason: 'below_min_cards' });

  await updateSettings({ quizMinCards: 2 });
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
  }
  // The scene clears: the retry shows the quiz and the regular rhythm resumes.
  device.browser.reply = () => ({ shown: true });
  at(t, now + RETRY_MINUTES * MINUTE);
  assert.equal(await runScheduledQuiz(), 'shown');
  assert.equal(alarmAt(), now + RETRY_MINUTES * MINUTE + 20 * MINUTE);
});

test('only one tab is ever asked, and only its top frame', async () => {
  await fill();
  await runScheduledQuiz();
  await runScheduledQuiz();
  assert.ok(device.browser.sent.every((sent) => sent.tabId === 1 && sent.options.frameId === 0));
  assert.equal(device.browser.sent.length, 2);
});

test('the diagnostics say what the panel needs to know', async (t) => {
  await fill(9);
  await ensureScheduled();
  let d = await getDiagnostics();
  assert.deepEqual(
    { enabled: d.enabled, total: d.total, minCards: d.minCards, askable: d.askable, meanings: d.meanings, targetLang: d.targetLang, standingReason: d.standingReason, nextAt: d.nextAt, alarmAt: d.alarmAt, lastAttempt: d.lastAttempt },
    { enabled: true, total: 9, minCards: 10, askable: 9, meanings: 9, targetLang: 'tr', standingReason: 'below_min_cards', nextAt: T0 + 20 * MINUTE, alarmAt: T0 + 20 * MINUTE, lastAttempt: null },
  );

  await fill();
  device.browser.reply = () => ({ shown: false, reason: 'video_playing' });
  at(t, T0 + 20 * MINUTE);
  await runScheduledQuiz();
  d = await getDiagnostics();
  assert.equal(d.standingReason, '');
  assert.deepEqual(d.lastAttempt, { at: T0 + 20 * MINUTE, reason: 'video_playing' });
  assert.equal(d.nextAt, T0 + (20 + RETRY_MINUTES) * MINUTE);

  device.forgetAlarms();
  assert.equal((await getDiagnostics()).alarmAt, 0, 'a missing alarm is visible');

  await updateSettings({ quizEnabled: false });
  assert.equal((await getDiagnostics()).standingReason, 'disabled');
});

test('"Test now" builds a question whatever the timer, the switch and the word count say', async () => {
  await updateSettings({ quizEnabled: false });
  await fill(4);
  const built = await buildTestQuestion();
  assert.equal(built.ok, true);
  assert.equal(built.question.choices.length, 4);
  assert.equal(device.browser.sent.length, 0, 'nothing is sent to a tab');
  assert.equal(alarmAt(), undefined, 'and the plan is not touched');

  device = use(createDevice('small', { uiLanguage: 'tr' }));
  await fill(3);
  assert.deepEqual(await buildTestQuestion(), { ok: false, reason: 'not_enough_choices' });
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
  await runScheduledQuiz();
  assert.equal(device.browser.sent.at(-1).message.timeoutSeconds, 30, 'thirty seconds unless set otherwise');
  assert.equal((await buildTestQuestion()).timeoutSeconds, 30, '"Test now" shows the same card');

  for (const [setting, expected] of [[45, 45], [12.4, 12], [1, 5], [100_000, 300], [0, 30], [-3, 30], ['abc', 30], [null, 30]]) {
    await updateSettings({ quizTimeoutSeconds: setting });
    await runScheduledQuiz();
    assert.equal(device.browser.sent.at(-1).message.timeoutSeconds, expected, `setting ${JSON.stringify(setting)}`);
    assert.equal((await buildTestQuestion()).timeoutSeconds, expected);
  }
});
