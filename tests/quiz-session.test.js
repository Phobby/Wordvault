// A quiz with several questions: one after the other in the same place, a summary at the end;
// one quiz at a time; and "Not today".

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { updateSettings } from '../src/lib/settings.js';
import { addEntry, getEntry } from '../src/lib/vault.js';
import { ALARM_NAME, RETRY_MINUTES, answerQuestion, ensureScheduled, getDiagnostics, getQuizState, muteToday, quizPageGone, runScheduledQuiz, showQuiz, testQuiz, unmute } from '../src/quiz/scheduler.js';
import { readSession } from '../src/quiz/session.js';
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
/** The quiz as the page was given it. */
const quizOnPage = () => device.cards().at(-1);
/** What the card sends for the question it shows. */
const reply = (quiz, question, how) => ({ sessionId: quiz.sessionId, id: question.id, chars: question.chars, ...(typeof how === 'string' ? { outcome: how } : { outcome: 'answer', correct: how, ms: 2500 }) });
/** The start of the day after `now`, local time: where "today" ends. */
function midnightAfter(now) {
  const date = new Date(now);
  date.setHours(24, 0, 0, 0);
  return date.getTime();
}

test('three questions per quiz: each answer brings the next question, the last one the summary', async () => {
  await fill();
  await updateSettings({ quizQuestionsPerQuiz: 3 });
  assert.equal((await showQuiz()).reason, 'shown');
  const quiz = quizOnPage();
  assert.deepEqual([quiz.index, quiz.total], [1, 3]);

  const first = quiz.question;
  let said = await answerQuestion(reply(quiz, first, true));
  assert.equal(said.summary, null);
  assert.equal(said.next.index, 2);
  const second = said.next.question;
  assert.equal(second.choices.length, 4);

  said = await answerQuestion(reply(quiz, second, false));
  assert.equal(said.next.index, 3);
  const third = said.next.question;

  said = await answerQuestion(reply(quiz, third, true));
  assert.deepEqual(said, { next: null, summary: { right: 2, answered: 3, skipped: 0, asked: 3, total: 3 } });

  assert.equal(new Set([first.id, second.id, third.id]).size, 3, 'three different words');
  assert.equal(device.cards().length, 1, 'all in the same place: the page was sent one quiz');
  assert.equal(await readSession(), null, 'the quiz is over');
  // every answer went to its word
  assert.deepEqual([(await getEntry(first.id)).quiz.k, (await getEntry(second.id)).quiz.l, (await getEntry(third.id)).quiz.k], [1, 1, 1]);
  assert.deepEqual((await getQuizState()).recent, [first.id, second.id, third.id]);
});

test('the number of questions is what the setting says: 1, 3, 5 or 10', async () => {
  await fill();
  for (const [setting, total] of [[1, 1], [3, 3], [5, 5], [10, 10], [0, 1], [-2, 1], ['x', 1], [2.6, 3], [500, 20]]) {
    await updateSettings({ quizQuestionsPerQuiz: setting });
    assert.equal((await testQuiz()).ok, true);
    assert.equal(quizOnPage().total, total, `setting ${JSON.stringify(setting)}`);
    assert.equal((await getDiagnostics()).questionsPerQuiz, total);
  }
});

test('a quiz of ten questions asks ten different words and counts the right ones', async () => {
  await fill();
  await updateSettings({ quizQuestionsPerQuiz: 10 });
  await showQuiz();
  const quiz = quizOnPage();
  const asked = [quiz.question.id];
  let question = quiz.question;
  let said;
  for (let n = 1; n <= 10; n++) {
    said = await answerQuestion(reply(quiz, question, n % 3 !== 0)); // every third answer is wrong
    if (!said.next) break;
    assert.equal(said.next.index, n + 1);
    question = said.next.question;
    asked.push(question.id);
  }
  assert.equal(new Set(asked).size, 10);
  assert.deepEqual(said.summary, { right: 7, answered: 10, skipped: 0, asked: 10, total: 10 });
});

test('"Ask later" skips one question; "I don\'t know" counts as answered', async () => {
  await fill();
  await updateSettings({ quizQuestionsPerQuiz: 3 });
  await showQuiz();
  const quiz = quizOnPage();
  let said = await answerQuestion(reply(quiz, quiz.question, 'later'));
  assert.equal(said.next.index, 2, 'the quiz goes on');
  assert.equal((await getEntry(quiz.question.id)).quiz, null, 'nothing is held against the word that was put off');
  said = await answerQuestion(reply(quiz, said.next.question, 'unknown'));
  said = await answerQuestion(reply(quiz, said.next.question, true));
  assert.deepEqual(said.summary, { right: 1, answered: 2, skipped: 1, asked: 3, total: 3 });
});

test('closing the quiz, or a question nobody answers, ends the whole quiz without a summary', async () => {
  await fill();
  await updateSettings({ quizQuestionsPerQuiz: 5 });
  for (const outcome of ['closed', 'timeout']) {
    assert.equal((await testQuiz()).ok, true);
    const quiz = quizOnPage();
    const said = await answerQuestion(reply(quiz, quiz.question, true));
    assert.deepEqual(await answerQuestion(reply(quiz, said.next.question, outcome)), { next: null, summary: null }, outcome);
    assert.equal(await readSession(), null);
    assert.equal((await getEntry(said.next.question.id)).quiz, null, 'the open question does not count');
  }
});

test('one question per quiz: the answer ends it, and there is no summary', async () => {
  await fill();
  await showQuiz();
  const quiz = quizOnPage();
  assert.deepEqual(await answerQuestion(reply(quiz, quiz.question, true)), { next: null, summary: null });
  assert.equal(await readSession(), null);
});

test('a vault with fewer words than questions: the quiz ends when it has asked them all', async () => {
  await updateSettings({ quizQuestionsPerQuiz: 10, quizMinCards: 2 });
  await fill(5);
  await showQuiz();
  const quiz = quizOnPage();
  const asked = [];
  let question = quiz.question;
  let said;
  for (;;) {
    asked.push(question.id);
    said = await answerQuestion(reply(quiz, question, true));
    if (!said.next) break;
    question = said.next.question;
  }
  assert.equal(new Set(asked).size, 5, 'each word once, none twice');
  assert.deepEqual(said.summary, { right: 5, answered: 5, skipped: 0, asked: 5, total: 10 });
});

test('with "not due yet" switched off the quiz ends when no more words are due', async (t) => {
  await fill();
  await updateSettings({ quizQuestionsPerQuiz: 5, quizAllowNotDue: false });
  // Ten of the twelve words were answered a moment ago; two are still due.
  for (const pair of WORDS.slice(0, 10)) await answerQuestion({ id: `en|tr|${pair.split(':')[0]}`, correct: true, ms: 2000 });
  at(t, T0 + MINUTE);
  assert.equal((await showQuiz()).reason, 'shown');
  const quiz = quizOnPage();
  let said = await answerQuestion(reply(quiz, quiz.question, true));
  said = await answerQuestion(reply(quiz, said.next.question, true));
  assert.deepEqual(said, { next: null, summary: { right: 2, answered: 2, skipped: 0, asked: 2, total: 5 } });
});

test('one quiz at a time: while one is on screen the next waits, and an abandoned one does not block for long', async (t) => {
  await fill();
  await updateSettings({ quizIntervalMinutes: 1, quizQuestionsPerQuiz: 10 });
  await ensureScheduled();
  at(t, T0 + MINUTE);
  assert.equal(await runScheduledQuiz(), 'shown');
  const quiz = quizOnPage();

  // A minute later the user is still answering.
  at(t, T0 + 2 * MINUTE - 20_000);
  await answerQuestion(reply(quiz, quiz.question, true));
  at(t, T0 + 2 * MINUTE);
  assert.equal(await runScheduledQuiz(), 'already_showing');
  assert.equal(device.cards().length, 1);
  assert.equal(device.alarmTimes()[ALARM_NAME], T0 + 2 * MINUTE + Math.min(RETRY_MINUTES, 1) * MINUTE);
  assert.equal((await getQuizState()).lastSkip.reason, 'already_showing');

  // The page with the quiz was closed without a word. Once its question would have timed out
  // (30 seconds) and a little more, the stale quiz no longer stands in the way.
  at(t, T0 + 3 * MINUTE);
  assert.equal(await runScheduledQuiz(), 'shown');
  assert.equal(device.cards().length, 2);
  assert.notEqual(quizOnPage().sessionId, quiz.sessionId);
});

test('an answer from a card that is no longer the current quiz is recorded and nothing more', async () => {
  await fill();
  await updateSettings({ quizQuestionsPerQuiz: 3 });
  await showQuiz();
  const old = quizOnPage();
  assert.equal((await testQuiz()).ok, true); // "Test now" takes the place of the quiz on screen
  const current = quizOnPage();
  assert.notEqual(current.sessionId, old.sessionId);

  assert.deepEqual(await answerQuestion(reply(old, old.question, true)), { next: null, summary: null });
  assert.equal((await getEntry(old.question.id)).quiz.a, 1, 'the answer itself is not lost');
  assert.equal((await readSession()).id, current.sessionId, 'the current quiz is untouched');
  // answers without a quiz behind them (an older card) are recorded the same way
  const other = WORDS.map((pair) => `en|tr|${pair.split(':')[0]}`).find((id) => id !== old.question.id && id !== current.question.id);
  assert.deepEqual(await answerQuestion({ id: other, correct: true, ms: 2000 }), { next: null, summary: null });
  assert.equal((await getEntry(other)).quiz.a, 1);
});

test('the place showing the quiz goes away without a word: the open question counts as closed', async (t) => {
  await fill();
  await updateSettings({ quizQuestionsPerQuiz: 3, quizIntervalMinutes: 1 });
  await ensureScheduled();
  at(t, T0 + MINUTE);
  assert.equal(await runScheduledQuiz(), 'shown');
  const quiz = quizOnPage();
  const said = await answerQuestion(reply(quiz, quiz.question, true));

  // The popup lost the focus (or the window, or the tab, was closed) during the second question.
  at(t, T0 + MINUTE + 10_000);
  await quizPageGone(quiz.sessionId);
  assert.equal(await readSession(), null);
  const state = await getQuizState();
  assert.deepEqual([state.lastAnswer.id, state.lastAnswer.outcome], [said.next.question.id, 'closed']);
  const open = await getEntry(said.next.question.id);
  assert.deepEqual([open.quiz, open.dueAt], [null, T0 + MINUTE + 10_000 + 10 * MINUTE], 'nothing is held against the word; it comes back a little later');
  assert.equal((await getEntry(quiz.question.id)).quiz.a, 1, 'the answer given before stays');

  // so the next quiz is not held up by a quiz nobody can see
  at(t, T0 + 2 * MINUTE);
  assert.equal(await runScheduledQuiz(), 'shown');

  // The connection of a quiz that ended in the ordinary way breaking changes nothing.
  const next = quizOnPage();
  await quizPageGone(quiz.sessionId);
  assert.equal((await readSession()).id, next.sessionId, 'an older quiz going away does not touch the current one');
  await answerQuestion(reply(next, next.question, 'closed'));
  const before = await getQuizState();
  await quizPageGone(next.sessionId);
  assert.deepEqual(await getQuizState(), before);
});

test('"Not today": the quiz on screen ends and none comes before tomorrow', async (t) => {
  await fill();
  await ensureScheduled();
  at(t, T0 + 20 * MINUTE);
  assert.equal(await runScheduledQuiz(), 'shown');
  const midnight = midnightAfter(T0 + 20 * MINUTE);

  at(t, T0 + 21 * MINUTE);
  await muteToday();
  assert.equal(await readSession(), null);
  let d = await getDiagnostics();
  assert.deepEqual([d.mutedUntil, d.standingReason, d.nextAt, d.alarmAt], [midnight, 'muted', midnight, midnight]);

  // nothing in between, even if an alarm went off
  at(t, T0 + 40 * MINUTE);
  assert.equal(await runScheduledQuiz(), 'not_due');
  await ensureScheduled();
  assert.equal(device.alarmTimes()[ALARM_NAME], midnight, 'starting again does not undo it');
  assert.equal((await showQuiz()).reason, 'muted');
  assert.equal(device.cards().length, 1);
  // "Test now" is not the timer
  assert.equal((await testQuiz()).ok, true);
  await answerQuestion(reply(quizOnPage(), quizOnPage().question, true));

  // tomorrow it goes on by itself
  at(t, midnight);
  assert.equal(await runScheduledQuiz(), 'shown');
  d = await getDiagnostics();
  assert.deepEqual([d.mutedUntil, d.standingReason, d.nextAt], [0, '', midnight + 20 * MINUTE]);
});

test('"Not today" can be taken back, and switching the quiz off and on takes it back too', async (t) => {
  await fill();
  await ensureScheduled();
  await muteToday();
  assert.equal((await getDiagnostics()).standingReason, 'muted');
  at(t, T0 + 5 * MINUTE);
  await unmute();
  let d = await getDiagnostics();
  assert.deepEqual([d.mutedUntil, d.standingReason, d.nextAt, d.alarmAt], [0, '', T0 + 25 * MINUTE, T0 + 25 * MINUTE]);

  await muteToday();
  await updateSettings({ quizEnabled: false });
  await ensureScheduled();
  await updateSettings({ quizEnabled: true });
  await ensureScheduled();
  d = await getDiagnostics();
  assert.deepEqual([d.mutedUntil, d.standingReason, d.nextAt], [0, '', T0 + 25 * MINUTE]);
});

test('"Not today" late in the evening does not bring a quiz at the stroke of midnight if one was planned later', async (t) => {
  await fill();
  await updateSettings({ quizIntervalMinutes: 240 });
  const midnight = midnightAfter(T0);
  at(t, midnight - 10 * MINUTE);
  await ensureScheduled(); // planned for 03:50
  await muteToday();
  assert.equal((await getDiagnostics()).nextAt, midnight + 230 * MINUTE);
  // changing the frequency while muted still does not plan anything for today
  await updateSettings({ quizIntervalMinutes: 5 });
  await ensureScheduled();
  assert.equal((await getDiagnostics()).nextAt, midnight);
});
