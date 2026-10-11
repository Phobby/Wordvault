'use strict';

// The quiz card: a saved word and four possible meanings, in the top right corner. Used on web
// pages (content/quiz.js) and on the options page ("Test now").
//
// A question ends in exactly one of five ways, reported once through onResult:
//   answer    a choice was picked (right or wrong, with the time it took)
//   unknown   "I don't know": counts as wrong, the right answer is shown
//   later     "Ask later"                    \
//   timeout   nobody answered in time         } nothing is held against the word
//   closed    the card was closed            /

(function (WV) {
  if (WV.quizCard) return;
  const { h, t, icon, languages } = WV;

  const ICON_CLOSE = 'M6 6l12 12M18 6L6 18';
  /** How long the result stays on screen before the card closes itself. */
  const RIGHT_MS = 2000;
  const WRONG_MS = 3500;

  let surface = null;
  let current = null; // the card on screen

  /** Ends the question: stops the clocks and reports the outcome. Only the first call counts. */
  function finish(outcome, details) {
    if (!current || current.outcome) return false;
    const { question, stopwatch, onResult } = current;
    current.outcome = outcome;
    clearTimeout(current.timeoutTimer);
    current.countdown?.cancel();
    current.timerBar.hidden = true;
    stopwatch.stop();
    onResult?.({ id: question.id, outcome, chars: question.chars, ...details });
    return true;
  }

  function close() {
    if (!current) return;
    finish('closed'); // unless it already ended some other way
    clearTimeout(current.closeTimer);
    const { onClose } = current;
    current = null;
    surface.unmount();
    onClose?.();
  }

  /** Shows which choice was right, and closes the card a moment later. */
  function reveal(messageKey, picked) {
    const { question, buttons, actions, feedback } = current;
    const correct = picked === question.answer;
    for (const button of buttons) button.disabled = true;
    buttons[question.answer].classList.add('wv-right');
    if (picked !== null && !correct) buttons[picked].classList.add('wv-wrong');
    actions.hidden = true;
    feedback.textContent = t(messageKey);
    feedback.classList.add(correct ? 'wv-right' : 'wv-wrong');
    feedback.hidden = false;
    current.closeTimer = setTimeout(close, correct ? RIGHT_MS : WRONG_MS);
  }

  function answer(index) {
    if (!current || current.outcome) return;
    const correct = index === current.question.answer;
    // Read before finish() stops the stopwatch: the time from the choices appearing to this click.
    const ms = current.stopwatch.elapsed();
    finish('answer', { correct, choice: index, ms });
    reveal(correct ? 'quizCorrect' : 'quizWrong', index);
  }

  function unknown() {
    if (finish('unknown')) reveal('quizUnknownFeedback', null);
  }

  /** "Ask later" and the timeout: the card just goes away. */
  function dismiss(outcome) {
    if (finish(outcome)) close();
  }

  /** The bar that shrinks while the question waits for an answer. */
  function startCountdown(bar, ms) {
    try {
      return bar.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], { duration: ms, easing: 'linear', fill: 'forwards' });
    } catch {
      return null; // no Web Animations here; the timeout itself does not depend on the bar
    }
  }

  /**
   * Shows a question (replacing the one on screen, if any).
   *
   * @param {import('../quiz/question.js').Question} question
   * @param {Object} [options]
   * @param {number} [options.timeoutSeconds]  An unanswered question goes away after this long
   *   (outcome 'timeout'). 0 or missing: it stays until it is answered or closed.
   * @param {(result: { id: string, outcome: 'answer' | 'unknown' | 'later' | 'timeout' | 'closed',
   *   chars: number, correct?: boolean, choice?: number, ms?: number }) => void} [options.onResult]
   *   Called once per question. `correct`, `choice` and `ms` come with 'answer' only.
   * @param {() => void} [options.onClose]  The card has left the screen.
   */
  function show(question, { timeoutSeconds = 0, onResult, onClose } = {}) {
    surface ||= WV.createSurface(WV.styles.quiz);
    close();
    const buttons = question.choices.map((choice, index) =>
      h('button', { class: 'wv-quiz-choice', type: 'button', dir: 'auto', lang: question.targetLang || null, text: choice, onclick: () => answer(index) }),
    );
    const actions = h(
      'div',
      { class: 'wv-quiz-actions' },
      h('button', { class: 'wv-quiz-action', type: 'button', 'data-action': 'unknown', title: t('quizUnknownHint'), text: t('quizUnknown'), onclick: unknown }),
      h('button', { class: 'wv-quiz-action', type: 'button', 'data-action': 'later', title: t('quizLaterHint'), text: t('quizLater'), onclick: () => dismiss('later') }),
    );
    const feedback = h('div', { class: 'wv-quiz-feedback', role: 'status', hidden: true });
    const bar = h('div', { class: 'wv-quiz-timer-bar' });
    const timerBar = h('div', { class: 'wv-quiz-timer', hidden: true }, bar);
    surface.root.replaceChildren(
      h(
        'div',
        { class: 'wv-quiz', role: 'dialog', 'aria-label': t('quizTitle') },
        h(
          'div',
          { class: 'wv-quiz-head' },
          h('span', { class: 'wv-quiz-title', text: t('quizTitle') }),
          h('button', { class: 'wv-btn-icon', type: 'button', 'data-action': 'close', title: t('popupClose'), 'aria-label': t('popupClose'), onclick: close }, icon(ICON_CLOSE)),
        ),
        h('div', { class: 'wv-quiz-word', dir: 'auto', lang: question.sourceLang || null, text: question.word }),
        h('div', { class: 'wv-quiz-prompt', text: t('quizPrompt', [languages.name(question.targetLang)]) }),
        h('div', { class: 'wv-quiz-choices' }, buttons),
        h('div', { class: 'wv-quiz-foot' }, actions, feedback),
        timerBar,
      ),
    );
    surface.mount(null);

    const card = { question, buttons, actions, feedback, timerBar, stopwatch: WV.createStopwatch(), outcome: '', countdown: null, timeoutTimer: 0, closeTimer: 0, onResult, onClose };
    current = card;

    // The answer time starts when the choices are on screen: after the first frame with the
    // card in it has been painted. In a tab that is not visible no frame is painted, and the
    // stopwatch waits with it.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (current === card && !card.outcome) card.stopwatch.start();
      }),
    );

    // ASSUMPTION: the timeout runs in real time, also while the tab is hidden; only the answer
    // time is paused there. A card nobody is looking at then goes away by itself instead of
    // waiting in a background tab while the next quiz appears somewhere else.
    const timeoutMs = Number(timeoutSeconds) > 0 ? Number(timeoutSeconds) * 1000 : 0;
    if (timeoutMs) {
      timerBar.hidden = false;
      card.countdown = startCountdown(bar, timeoutMs);
      card.timeoutTimer = setTimeout(() => {
        if (current === card) dismiss('timeout');
      }, timeoutMs);
    }
  }

  WV.quizCard = { show, close, isOpen: () => Boolean(current) };
})(globalThis.WV);
